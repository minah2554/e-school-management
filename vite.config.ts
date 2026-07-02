import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Load environment variables from process.cwd()
  const env = loadEnv(mode, process.cwd(), '');
  const apiKey = env.GEMINI_API_KEY || process.env.GEMINI_API_KEY;

  return {
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'mock-vercel-api',
        configureServer(server) {
          server.middlewares.use(async (req, res, next) => {
            if (req.url === '/api/gemini-counseling' && req.method === 'POST') {
              let body = '';
              req.on('data', chunk => { body += chunk; });
              req.on('end', async () => {
                try {
                  const parsedBody = JSON.parse(body || '{}');
                  if (!apiKey) {
                    res.statusCode = 500;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ error: 'GEMINI_API_KEY is not defined. Please create a .env.local file with GEMINI_API_KEY.' }));
                    return;
                  }

                  let textContent = '';
                  let isHwpx = false;

                  if (parsedBody.fileData && parsedBody.fileData.base64) {
                    if (parsedBody.fileData.base64.startsWith('UEsDB')) {
                      isHwpx = true;
                    }
                  }

                  if (isHwpx) {
                    try {
                      const zlib = require('zlib');
                      const zipBuffer = Buffer.from(parsedBody.fileData.base64, 'base64');
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

                  const parts: any[] = [];
                  if (textContent) {
                    parts.push({
                      text: `다음은 공문(HWPX)에서 추출한 텍스트 내용이다:\n\n${textContent}\n\n위 텍스트 정보를 바탕으로 아래 프롬프트에 답하라.\n\n${parsedBody.prompt}`
                    });
                  } else {
                    parts.push({
                      text: parsedBody.prompt
                    });
                    if (parsedBody.fileData && parsedBody.fileData.base64 && parsedBody.fileData.mimeType) {
                      parts.push({
                        inlineData: {
                          mimeType: parsedBody.fileData.mimeType,
                          data: parsedBody.fileData.base64
                        }
                      });
                    }
                  }

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

                  const data: any = await response.json();
                  res.statusCode = response.status;
                  res.setHeader('Content-Type', 'application/json');
                  if (response.ok) {
                    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
                    res.end(JSON.stringify({ text }));
                  } else {
                    res.end(JSON.stringify({ error: 'Gemini API Error', details: data }));
                  }
                } catch (err: any) {
                  res.statusCode = 500;
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ error: err.message || 'Internal Server Error' }));
                }
              });
            } else {
              next();
            }
          });
        }
      }
    ]
  };
})
