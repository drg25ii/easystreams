const { USER_AGENT } = require('./common');

async function extractVixCloud(url) {
    try {
        const response = await fetch(url, {
            headers: {
                "User-Agent": USER_AGENT,
                "Referer": "https://www.animeunity.so/"
            }
        });

        if (!response.ok) return null;
        const html = await response.text();

        const streams = [];

        // Extract Direct MP4 (downloadUrl)
        const downloadRegex = /window\.downloadUrl\s*=\s*'([^']+)'/;
        const downloadMatch = downloadRegex.exec(html);
        
        if (downloadMatch) {
            const downloadUrl = downloadMatch[1];
            let quality = "Unknown";
            if (downloadUrl.includes("1080p")) quality = "1080p";
            else if (downloadUrl.includes("720p")) quality = "720p";
            else if (downloadUrl.includes("480p")) quality = "480p";
            else if (downloadUrl.includes("360p")) quality = "360p";

            streams.push({
                url: downloadUrl,
                quality: quality,
                type: "direct",
                headers: {
                    "User-Agent": USER_AGENT,
                    "Referer": "https://vixcloud.co/"
                }
            });
        }

        // Extract HLS (streams)
        const streamsRegex = /window\.streams\s*=\s*(\[{[^\]]+}\])/;
        const streamsMatch = streamsRegex.exec(html);

        if (streamsMatch) {
            try {
                const playlistData = JSON.parse(streamsMatch[1]);
                for (const item of playlistData) {
                    if (item.url) {
                         streams.push({
                            url: item.url,
                            quality: "Auto",
                            type: "m3u8",
                            headers: {
                                "User-Agent": USER_AGENT,
                                "Referer": "https://vixcloud.co/"
                            }
                        });
                    }
                }
            } catch (e) {
                console.error("[VixCloud] Failed to parse streams JSON:", e);
            }
        }
        
        return streams;

    } catch (e) {
        console.error("[VixCloud] Extraction error:", e);
        return [];
    }
}

module.exports = { extractVixCloud };
