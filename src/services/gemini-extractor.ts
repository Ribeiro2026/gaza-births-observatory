import { GoogleGenAI, Type } from '@google/genai';
import dns from 'node:dns/promises';
import net from 'node:net';

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

export interface ExtractedBirthObservation {
  period_type: 'Monthly' | 'Yearly';
  period: string;
  count: number;
  source_date: string;
  suggested_source: string;
  document_ref: string;
  snippet: string;
}

function isPrivateOrReservedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts[0] === 10) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 0) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (
      lower === '::1' ||
      lower === '::' ||
      lower.startsWith('fc') ||
      lower.startsWith('fd') ||
      lower.startsWith('fe80') ||
      lower.startsWith('::ffff:127.') ||
      lower.startsWith('::ffff:10.') ||
      lower.startsWith('::ffff:169.254.') ||
      lower.startsWith('::ffff:192.168.')
    ) {
      return true;
    }
    return false;
  }
  return true;
}

export async function validateSafePublicUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error('Invalid URL format. Provide a full http:// or https:// URL.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http:// and https:// URLs are supported.');
  }

  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname === 'metadata.google.internal'
  ) {
    throw new Error('Internal or local network hostnames are not permitted.');
  }

  if (net.isIP(hostname)) {
    if (isPrivateOrReservedIp(hostname)) {
      throw new Error('Private or loopback IP addresses are not permitted.');
    }
    return parsed;
  }

  try {
    const addresses = await dns.lookup(hostname, { all: true });
    if (addresses.length === 0) {
      throw new Error('Could not resolve host address.');
    }
    for (const addr of addresses) {
      if (isPrivateOrReservedIp(addr.address)) {
        throw new Error('Target host resolves to a restricted network address.');
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('restricted')) {
      throw err;
    }
    throw new Error('Unable to resolve or verify the target URL hostname.');
  }

  return parsed;
}

export function stripHtmlAndXmlToText(rawBody: string): string {
  // Handle RSS/Atom feeds gracefully by preserving item titles, dates, and descriptions
  const withoutScripts = rawBody
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');

  const withBreaks = withoutScripts
    .replace(/<\/(p|div|li|tr|h[1-6]|item|entry|title|description|pubDate)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");

  return withBreaks
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 18000);
}

export async function fetchPublicUrlContent(rawUrl: string): Promise<{
  url: string;
  extractedText: string;
  contentType: string;
}> {
  let currentUrl = (await validateSafePublicUrl(rawUrl)).toString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    let response: Response | null = null;
    for (let hop = 0; hop <= 3; hop++) {
      response = await fetch(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': 'GazaBirthsObservatory/1.0 (Research RSS & Bulletin Parser)',
          Accept: 'application/rss+xml, application/xml, text/xml, text/html, text/plain',
        },
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) {
          throw new Error('Remote server returned an empty redirect.');
        }
        const resolvedNext = new URL(location, currentUrl).toString();
        currentUrl = (await validateSafePublicUrl(resolvedNext)).toString();
        continue;
      }
      break;
    }

    if (!response) {
      throw new Error('No response received from remote URL.');
    }

    if (response.status >= 300 && response.status < 400) {
      throw new Error('Too many redirects while fetching the target URL.');
    }

    if (!response.ok) {
      throw new Error(`Remote source responded with HTTP ${response.status}.`);
    }

    const contentType = response.headers.get('content-type') || 'text/plain';
    const rawText = await response.text();
    const extractedText = stripHtmlAndXmlToText(rawText);

    if (!extractedText || extractedText.length < 20) {
      throw new Error('Fetched document did not contain readable text.');
    }

    return {
      url: currentUrl,
      extractedText,
      contentType,
    };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Timed out while fetching the target URL (12s limit).');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export async function extractBirthStatsWithGemini(input: {
  rawText: string;
  sourceUrl?: string;
  sourceHint?: string;
}): Promise<ExtractedBirthObservation[]> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error(
      'GEMINI_API_KEY is not configured on the server. Add your key in Settings > Secrets.'
    );
  }

  const prompt = `Analyze the following text (which may be in English or Arabic, and may come from an RSS feed, UN situation report, Ministry press release, news article, or Telegram channel post) and extract ALL explicit birth statistics / newborn delivery counts reported for Gaza.

Source hint: ${input.sourceHint || 'Unknown'}
Source URL: ${input.sourceUrl || 'Manual text paste'}

Rules:
- Only extract explicit birth / live delivery / newborn counts tied to a specific month (YYYY-MM) or full year (YYYY).
- If the text gives a daily rate AND explicitly states a monthly/yearly total, extract the monthly/yearly total. If only a daily average is stated for a specific named month (e.g. "150 births per day in January 2025"), compute the integer count for that month and note it in the snippet.
- Never fabricate counts if the text does not mention birth counts for Gaza; return an empty array instead.
- For suggested_source, match one of these canonical names when clearly applicable: "MOH Gaza", "Ministry of Interior", "UN OCHA", "UNFPA Palestine", "Al Jazeera", "MOH Official Telegram", or provide the exact publishing organization name.
- Provide the verbatim quote (or concise translated quote if Arabic) in "snippet".
- Format source_date as YYYY-MM-DD (default to today's date if not explicitly stated).

TEXT TO PARSE:
${input.rawText.slice(0, 16000)}`;

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: prompt,
    config: {
      systemInstruction:
        'You are a meticulous demographic data extraction engine. Return strictly valid JSON matching the schema containing verifiable birth counts for Gaza extracted directly from the provided text.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            period_type: {
              type: Type.STRING,
              description: 'Must be either "Monthly" or "Yearly".',
            },
            period: {
              type: Type.STRING,
              description:
                'Period value: "YYYY-MM" for Monthly reports (e.g. "2025-01"), or "YYYY" for Yearly reports (e.g. "2024").',
            },
            count: {
              type: Type.INTEGER,
              description: 'Integer count of reported births for the period.',
            },
            source_date: {
              type: Type.STRING,
              description: 'Publication date of the bulletin or post in YYYY-MM-DD format.',
            },
            suggested_source: {
              type: Type.STRING,
              description: 'Publishing entity name (e.g. MOH Gaza, UN OCHA, UNFPA Palestine, Al Jazeera).',
            },
            document_ref: {
              type: Type.STRING,
              description: 'Bulletin ID, SitRep number, Telegram post ID, or concise headline reference.',
            },
            snippet: {
              type: Type.STRING,
              description: 'Verbatim excerpt or exact sentence containing the reported figure.',
            },
          },
          required: [
            'period_type',
            'period',
            'count',
            'source_date',
            'suggested_source',
            'document_ref',
            'snippet',
          ],
        },
      },
    },
  });

  const rawJson = (response.text ?? '[]').trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error('Gemini returned malformed JSON during extraction.');
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .map((item) => {
      const periodType: 'Monthly' | 'Yearly' =
        item.period_type === 'Yearly' || /^\d{4}$/.test(String(item.period ?? ''))
          ? 'Yearly'
          : 'Monthly';
      const count = Math.round(Number(item.count));
      return {
        period_type: periodType,
        period: String(item.period ?? '').trim(),
        count: Number.isFinite(count) && count > 0 ? count : 0,
        source_date: String(item.source_date ?? new Date().toISOString().slice(0, 10)).trim(),
        suggested_source: String(item.suggested_source ?? input.sourceHint ?? 'Unclassified Source').trim(),
        document_ref: String(item.document_ref ?? 'AUTO-EXTRACT').trim(),
        snippet: String(item.snippet ?? '').trim(),
      };
    })
    .filter((row) => row.count > 0 && row.period.length >= 4 && row.snippet.length > 0);
}
