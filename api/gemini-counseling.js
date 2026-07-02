// api/gemini-counseling.js

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method Not Allowed. Use POST.' });
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'GEMINI_API_KEY is not configured on the server.' });
    }

    const { prompt, fileData } = req.body || {};
    if (!prompt) {
      return res.status(400).json({ error: 'Missing prompt in request body.' });
    }

    let textContent = '';
    let isHwpx = false;

    if (fileData && fileData.base64) {
      if (fileData.base64.startsWith('UEsDB')) {
        isHwpx = true;
      }
    }

    if (isHwpx) {
      try {
        const zlib = require('zlib');
        const zipBuffer = Buffer.from(fileData.base64, 'base64');
        let offset = 0;
        let sectionsText = [];

        while (offset < zipBuffer.length) {
          if (offset + 30 > zipBuffer.length) break;
          const signature = zipBuffer.readUInt32LE(offset);
          if (signature !== 0x04034b50) {
            break; 
          }
          const compressionMethod = zipBuffer.readUInt16LE(offset + 8);
          const compressedSize = zipBuffer.readUInt32LE(offset + 18);
          const fileNameLength = zipBuffer.readUInt16LE(offset + 26);
          const extraFieldLength = zipBuffer.readUInt16LE(offset + 28);
          
          if (offset + 30 + fileNameLength > zipBuffer.length) break;
          const fileName = zipBuffer.toString('utf8', offset + 30, offset + 30 + fileNameLength);
          const dataOffset = offset + 30 + fileNameLength + extraFieldLength;
          
          if (fileName.startsWith('Contents/section') && fileName.endsWith('.xml')) {
            if (dataOffset + compressedSize > zipBuffer.length) break;
            const compressedData = zipBuffer.slice(dataOffset, dataOffset + compressedSize);
            let xmlContent = '';
            if (compressionMethod === 8) {
              xmlContent = zlib.inflateRawSync(compressedData).toString('utf8');
            } else if (compressionMethod === 0) {
              xmlContent = compressedData.toString('utf8');
            }
            
            const matches = xmlContent.match(/<hp:t[^>]*>([\s\S]*?)<\/hp:t>/g);
            if (matches) {
              const secText = matches.map(m => m.replace(/<[^>]+>/g, '')).join(' ');
              sectionsText.push(secText);
            }
          }
          
          offset = dataOffset + compressedSize;
        }

        if (sectionsText.length > 0) {
          textContent = sectionsText.join('\n\n');
        }
      } catch (zipErr) {
        console.error('Failed to parse HWPX zip streams:', zipErr);
      }
    }

    const parts = [];
    if (textContent) {
      parts.push({
        text: `다음은 공문(HWPX)에서 추출한 텍스트 내용이다:\n\n${textContent}\n\n위 텍스트 정보를 바탕으로 아래 프롬프트에 답하라.\n\n${prompt}`
      });
    } else {
      parts.push({
        text: prompt
      });
      if (fileData && fileData.base64 && fileData.mimeType) {
        parts.push({
          inlineData: {
            mimeType: fileData.mimeType,
            data: fileData.base64
          }
        });
      }
    }

    // Call Gemini 2.0 Flash API using native fetch
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              parts: parts
            }
          ]
        })
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({
        error: `Gemini API returned status ${response.status}`,
        details: errText
      });
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!text) {
      return res.status(500).json({ error: 'Empty response from Gemini API.', details: data });
    }

    return res.status(200).json({ text });
  } catch (error) {
    console.error('Error in gemini-counseling handler:', error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
}
