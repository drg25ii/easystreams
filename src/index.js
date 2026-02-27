const animeunity = require('./animeunity/index');
const animeworld = require('./animeworld/index');
const guardahd = require('./guardahd/index');
const guardaserie = require('./guardaserie/index');
const guardoserie = require('./guardoserie/index');
const streamingcommunity = require('./streamingcommunity/index');
const { getTmdbFromKitsu } = require('./tmdb_helper');

const MAPPING_API_URL = 'https://animemapping.stremio.dpdns.org';
const TMDB_API_KEY = '68e094699525b18a70bab2f86b1fa706';
const CONTEXT_TIMEOUT = 3000;

function isMeaningfulSeasonName(name) {
    const clean = String(name || '').trim();
    if (!clean) return false;
    if (/^Season\s+\d+$/i.test(clean)) return false;
    if (/^Stagione\s+\d+$/i.test(clean)) return false;
    return true;
}

function mergeDistinctStrings(base = [], incoming = []) {
    const merged = [...(Array.isArray(base) ? base : []), ...(Array.isArray(incoming) ? incoming : [])]
        .map((s) => String(s || '').trim())
        .filter(Boolean);
    return [...new Set(merged)];
}

function hasUsefulMappingSignals(payload) {
    if (!payload || typeof payload !== 'object') return false;

    const numericIdFields = ['tmdbId', 'kitsuId', 'malId', 'anilistId', 'anidbId', 'anisearchId', 'bangumiId', 'livechartId'];
    for (const field of numericIdFields) {
        const n = Number.parseInt(payload[field], 10);
        if (Number.isInteger(n) && n > 0) return true;
    }

    const textIdFields = ['tvdbId', 'seasonName', 'animePlanetId'];
    for (const field of textIdFields) {
        const value = String(payload[field] || '').trim();
        if (!value) continue;
        if (field === 'seasonName' && !isMeaningfulSeasonName(value)) continue;
        return true;
    }

    if (Array.isArray(payload.titleHints) && payload.titleHints.some((x) => String(x || '').trim().length > 0)) {
        return true;
    }

    if (Array.isArray(payload.mappedSeasons) && payload.mappedSeasons.some((x) => Number.isInteger(Number.parseInt(x, 10)) && Number.parseInt(x, 10) > 0)) {
        return true;
    }

    const parsedSeriesCount = Number.parseInt(payload.seriesSeasonCount, 10);
    if (Number.isInteger(parsedSeriesCount) && parsedSeriesCount > 0) return true;

    return false;
}

function applyMappingHintsToContext(context, payload) {
    if (!context || !payload || typeof payload !== 'object') return;

    const tmdbCandidate = String(payload.tmdbId || '').trim();
    if (/^tmdb:\d+$/i.test(tmdbCandidate)) {
        context.tmdbId = tmdbCandidate.split(':')[1];
    } else if (/^\d+$/.test(tmdbCandidate)) {
        context.tmdbId = tmdbCandidate;
    } else if (/^tt\d+$/i.test(tmdbCandidate) && !context.imdbId) {
        // Some fallbacks return IMDb where TMDB is expected.
        context.imdbId = tmdbCandidate;
    }

    const imdbCandidate = String(payload.imdbId || '').trim();
    if (/^tt\d+$/i.test(imdbCandidate)) {
        context.imdbId = imdbCandidate;
    }

    const parsedSeason = Number.parseInt(payload.season, 10);
    if (Number.isInteger(parsedSeason) && parsedSeason >= 0) {
        context.mappedSeason = parsedSeason;
    }

    const seasonNameCandidate = String(payload.seasonName || '').trim();
    if (isMeaningfulSeasonName(seasonNameCandidate)) {
        context.seasonName = seasonNameCandidate;
    }

    context.titleHints = mergeDistinctStrings(context.titleHints, payload.titleHints);

    if (typeof payload.longSeries === 'boolean') {
        context.longSeries = payload.longSeries;
    }

    const mode = String(payload.episodeMode || '').trim().toLowerCase();
    if (mode) {
        context.episodeMode = mode;
    }

    if (Array.isArray(payload.mappedSeasons)) {
        const normalized = payload.mappedSeasons
            .map((n) => Number.parseInt(n, 10))
            .filter((n) => Number.isInteger(n) && n > 0);
        if (normalized.length > 0) {
            context.mappedSeasons = [...new Set(normalized)].sort((a, b) => a - b);
        }
    }

    const parsedSeriesCount = Number.parseInt(payload.seriesSeasonCount, 10);
    if (Number.isInteger(parsedSeriesCount) && parsedSeriesCount > 0) {
        context.seriesSeasonCount = parsedSeriesCount;
    }
}

function computeCanonicalSeason(requestedSeason, mappedSeason, topology = null) {
    if (requestedSeason === 0) return 0;

    const parsedMappedSeason = Number.parseInt(mappedSeason, 10);
    const longSeries = topology?.longSeries === true;
    const episodeMode = String(topology?.episodeMode || '').trim().toLowerCase();
    const isAbsoluteLongSeries = longSeries && episodeMode === 'absolute';

    if (!isAbsoluteLongSeries && Number.isInteger(parsedMappedSeason) && parsedMappedSeason > 0) {
        return parsedMappedSeason;
    }
    return requestedSeason;
}

async function fetchJsonWithTimeout(url, timeoutMs = CONTEXT_TIMEOUT) {
    if (typeof fetch === 'undefined') return null;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) return null;
        return await response.json();
    } catch {
        return null;
    } finally {
        clearTimeout(timeoutId);
    }
}

async function fetchMappingByRoute(route, value, season) {
    if (!MAPPING_API_URL || !route || !value) return null;
    const encodedValue = encodeURIComponent(String(value).trim());
    let url = `${MAPPING_API_URL}/mapping/${route}/${encodedValue}`;
    if (Number.isInteger(season) && season >= 0) {
        url += `?season=${season}`;
    }
    return await fetchJsonWithTimeout(url);
}

async function fetchTmdbIdFromImdb(imdbId, normalizedType) {
    if (!TMDB_API_KEY || !imdbId) return null;
    const url = `https://api.themoviedb.org/3/find/${encodeURIComponent(imdbId)}?api_key=${TMDB_API_KEY}&external_source=imdb_id`;
    const payload = await fetchJsonWithTimeout(url);
    if (!payload || typeof payload !== 'object') return null;

    if (normalizedType === 'movie') {
        if (Array.isArray(payload.movie_results) && payload.movie_results.length > 0) {
            return payload.movie_results[0].id;
        }
        if (Array.isArray(payload.tv_results) && payload.tv_results.length > 0) {
            return payload.tv_results[0].id;
        }
    } else {
        if (Array.isArray(payload.tv_results) && payload.tv_results.length > 0) {
            return payload.tv_results[0].id;
        }
        if (Array.isArray(payload.movie_results) && payload.movie_results.length > 0) {
            return payload.movie_results[0].id;
        }
    }

    return null;
}

async function resolveProviderRequestContext(id, type, season) {
    const context = {
        idType: 'raw',
        providerId: String(id || ''),
        requestedSeason: Number.isInteger(season) ? season : 1,
        tmdbId: null,
        imdbId: null,
        mappedSeason: null,
        seasonName: null,
        titleHints: [],
        longSeries: false,
        episodeMode: null,
        mappedSeasons: [],
        seriesSeasonCount: null,
        mappingLookupMiss: false,
        canonicalSeason: Number.isInteger(season) ? season : 1
    };

    let rawId = String(id || '');
    try {
        rawId = decodeURIComponent(rawId);
    } catch {
        // keep raw id
    }
    const idStr = rawId.trim();

    try {
        if (idStr.startsWith('kitsu:')) {
            context.idType = 'kitsu';
            const mapping = await getTmdbFromKitsu(idStr);
            if (mapping) {
                applyMappingHintsToContext(context, {
                    tmdbId: mapping.tmdbId,
                    season: mapping.season,
                    seasonName: mapping.tmdbSeasonTitle,
                    titleHints: mapping.titleHints,
                    longSeries: mapping.longSeries,
                    episodeMode: mapping.episodeMode,
                    mappedSeasons: mapping.mappedSeasons,
                    seriesSeasonCount: mapping.seriesSeasonCount
                });
            }
        } else if (idStr.startsWith('tmdb:')) {
            context.idType = 'tmdb';
            const parts = idStr.split(':');
            if (parts.length >= 2 && /^\d+$/.test(parts[1])) {
                context.tmdbId = parts[1];
            }
        } else if (/^tt\d+$/i.test(idStr)) {
            context.idType = 'imdb';
            context.imdbId = idStr;
            let mappingSignalsFound = false;
            const byImdb = await fetchMappingByRoute('by-imdb', idStr, context.requestedSeason);
            if (byImdb) {
                applyMappingHintsToContext(context, byImdb);
                mappingSignalsFound = hasUsefulMappingSignals(byImdb);
            }
            context.mappingLookupMiss = !mappingSignalsFound;
            if (!context.tmdbId && !context.mappingLookupMiss) {
                const fallbackTmdbId = await fetchTmdbIdFromImdb(idStr, String(type || '').toLowerCase());
                if (fallbackTmdbId !== null && fallbackTmdbId !== undefined) {
                    context.tmdbId = String(fallbackTmdbId);
                }
            }
        } else if (/^\d+$/.test(idStr)) {
            context.idType = 'tmdb-numeric';
            context.tmdbId = idStr;
        }

        const normalizedType = String(type || '').toLowerCase();
        const isSeriesLike = normalizedType === 'series' || normalizedType === 'tv' || normalizedType === 'anime';
        if (isSeriesLike && context.tmdbId && context.idType !== 'kitsu') {
            const byTmdb = await fetchMappingByRoute('by-tmdb', context.tmdbId, context.requestedSeason);
            if (byTmdb) {
                applyMappingHintsToContext(context, byTmdb);
            }
        }
    } catch {
        // Keep partial context.
    }

    context.canonicalSeason = computeCanonicalSeason(context.requestedSeason, context.mappedSeason, context);
    return context;
}

function isLikelyAnimeRequest(type, providerId, requestContext) {
    const normalizedType = String(type || '').toLowerCase();
    if (normalizedType === 'anime') return true;

    const normalizedProviderId = String(providerId || '').trim().toLowerCase();
    if (normalizedProviderId.startsWith('kitsu:')) return true;

    const contextIdType = String(requestContext?.idType || '').toLowerCase();
    if (contextIdType === 'kitsu') return true;

    if (requestContext?.longSeries === true && String(requestContext?.episodeMode || '').toLowerCase() === 'absolute') {
        return true;
    }

    return false;
}

function buildProviderRequestContext(context) {
    if (!context) return null;
    return {
        __requestContext: true,
        idType: context.idType,
        providerId: context.providerId,
        requestedSeason: context.requestedSeason,
        canonicalSeason: context.canonicalSeason,
        tmdbId: context.tmdbId,
        imdbId: context.imdbId,
        season: context.mappedSeason,
        mappedSeason: context.mappedSeason,
        seasonName: context.seasonName,
        mappedSeasonName: context.seasonName,
        titleHints: Array.isArray(context.titleHints) ? context.titleHints.slice() : [],
        mappedTitleHints: Array.isArray(context.titleHints) ? context.titleHints.slice() : [],
        longSeries: context.longSeries === true,
        episodeMode: context.episodeMode || null,
        mappedSeasons: Array.isArray(context.mappedSeasons) ? context.mappedSeasons.slice() : [],
        seriesSeasonCount: context.seriesSeasonCount
    };
}

async function getStreams(id, type, season, episode) {
    const streams = [];
    const normalizedType = String(type || '').toLowerCase();
    const normalizedSeason = Number.isInteger(season) ? season : (Number.parseInt(season, 10) || 1);
    const normalizedEpisode = Number.isInteger(episode) ? episode : (Number.parseInt(episode, 10) || 1);
    const providerContext = await resolveProviderRequestContext(id, normalizedType, normalizedSeason);
    const sharedContext = buildProviderRequestContext(providerContext);
    const promises = [];
    const likelyAnime = isLikelyAnimeRequest(normalizedType, id, providerContext);
    const forceNonAnimeForImdbMappingMiss =
        String(providerContext?.idType || '').toLowerCase() === 'imdb' &&
        providerContext?.mappingLookupMiss === true;

    const selectedProviders = [];
    if (normalizedType === 'movie') {
        if (forceNonAnimeForImdbMappingMiss) {
            selectedProviders.push('streamingcommunity', 'guardahd', 'guardoserie');
        } else if (likelyAnime) {
            selectedProviders.push('guardoserie', 'animeunity', 'animeworld');
        } else {
            selectedProviders.push('streamingcommunity', 'guardahd', 'guardoserie');
        }
    } else if (normalizedType === 'anime') {
        selectedProviders.push('animeunity', 'animeworld', 'guardaserie');
    } else if (normalizedType === 'tv' || normalizedType === 'series') {
        if (forceNonAnimeForImdbMappingMiss) {
            selectedProviders.push('streamingcommunity', 'guardaserie', 'guardoserie');
        } else if (likelyAnime) {
            selectedProviders.push('guardaserie', 'guardoserie', 'animeunity', 'animeworld');
        } else {
            selectedProviders.push('streamingcommunity', 'guardaserie', 'guardoserie');
        }
    } else {
        selectedProviders.push('streamingcommunity', 'guardahd', 'guardoserie');
    }

    for (const providerName of [...new Set(selectedProviders)]) {
        if (providerName === 'animeunity') {
            promises.push(
                animeunity.getStreams(id, normalizedType, normalizedSeason, normalizedEpisode, sharedContext)
                    .then(s => ({ provider: 'AnimeUnity', streams: s, status: 'fulfilled' }))
                    .catch(e => ({ provider: 'AnimeUnity', error: e, status: 'rejected' }))
            );
            continue;
        }
        if (providerName === 'animeworld') {
            promises.push(
                animeworld.getStreams(id, normalizedType, normalizedSeason, normalizedEpisode, null, sharedContext)
                    .then(s => ({ provider: 'AnimeWorld', streams: s, status: 'fulfilled' }))
                    .catch(e => ({ provider: 'AnimeWorld', error: e, status: 'rejected' }))
            );
            continue;
        }
        if (providerName === 'streamingcommunity') {
            promises.push(
                streamingcommunity.getStreams(id, normalizedType, normalizedSeason, normalizedEpisode, sharedContext)
                    .then(s => ({ provider: 'StreamingCommunity', streams: s, status: 'fulfilled' }))
                    .catch(e => ({ provider: 'StreamingCommunity', error: e, status: 'rejected' }))
            );
            continue;
        }
        if (providerName === 'guardahd') {
            promises.push(
                guardahd.getStreams(id, normalizedType, normalizedSeason, normalizedEpisode)
                    .then(s => ({ provider: 'GuardaHD', streams: s, status: 'fulfilled' }))
                    .catch(e => ({ provider: 'GuardaHD', error: e, status: 'rejected' }))
            );
            continue;
        }
        if (providerName === 'guardaserie') {
            promises.push(
                guardaserie.getStreams(id, normalizedType, normalizedSeason, normalizedEpisode, sharedContext)
                    .then(s => ({ provider: 'Guardaserie', streams: s, status: 'fulfilled' }))
                    .catch(e => ({ provider: 'Guardaserie', error: e, status: 'rejected' }))
            );
            continue;
        }
        if (providerName === 'guardoserie') {
            promises.push(
                guardoserie.getStreams(id, normalizedType, normalizedSeason, normalizedEpisode, sharedContext)
                    .then(s => ({ provider: 'Guardoserie', streams: s, status: 'fulfilled' }))
                    .catch(e => ({ provider: 'Guardoserie', error: e, status: 'rejected' }))
            );
        }
    }

    const results = await Promise.all(promises);
    for (const result of results) {
        if (result.status === 'fulfilled' && result.streams) {
            streams.push(...result.streams);
        }
    }

    return streams;
}

module.exports = { getStreams };
