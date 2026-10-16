import fs from 'node:fs';
import path from 'node:path';

async function main() {
  const assetsDir = path.join(process.cwd(), 'public/assets');
  const onoSendaiBase64 = fs.readFileSync(path.join(assetsDir, 'ono-sendai.png')).toString('base64');
  const kuangGradeBase64 = fs.readFileSync(path.join(assetsDir, 'kuang-grade.png')).toString('base64');
  const markElevenBase64 = fs.readFileSync(path.join(assetsDir, 'mark-eleven.png')).toString('base64');

  const onoDataUrl = `data:image/png;base64,${onoSendaiBase64}`;
  const kuangDataUrl = `data:image/png;base64,${kuangGradeBase64}`;
  const markDataUrl = `data:image/png;base64,${markElevenBase64}`;

  const welcomeHtmlPath = path.join(process.cwd(), 'public/welcome.html');
  let html = fs.readFileSync(welcomeHtmlPath, 'utf8');

  // Replace logo-strip styles and content
  const newLogoStrip = `
        <div class="logo-grid">
          <div class="logo-card">
            <img src="${onoDataUrl}" alt="Ono-Sendai Cyberspace 7" />
            <span class="logo-label">ONO-SENDAI 7</span>
          </div>
          <div class="logo-card">
            <img src="${kuangDataUrl}" alt="Kuang Grade Icebreaker" />
            <span class="logo-label">KUANG GRADE</span>
          </div>
          <div class="logo-card">
            <img src="${markDataUrl}" alt="Mark Eleven Navigator" />
            <span class="logo-label">MARK ELEVEN</span>
          </div>
        </div>`;

  // Update styles for 1/3 width grid
  const newStyles = `
      .logo-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 16px;
        margin-bottom: 24px;
      }

      .logo-card {
        background: #18181b;
        border: 1px solid #27272a;
        border-radius: 10px;
        padding: 16px 12px 12px 12px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.12);
        transition: transform 0.2s ease, border-color 0.2s ease;
      }

      .logo-card:hover {
        transform: translateY(-2px);
        border-color: #00d2ff;
      }

      .logo-card img {
        width: 100%;
        max-height: 130px;
        object-fit: contain;
      }

      .logo-label {
        font-family: "JetBrains Mono", Menlo, monospace;
        font-size: 11px;
        font-weight: 700;
        color: #e4e4e7;
        margin-top: 10px;
        letter-spacing: 1.5px;
      }
  `;

  // Replace existing styles and logo-strip
  html = html.replace(/\.logo-strip[\s\S]*?\.logo-strip img[\s\S]*?\}/, newStyles.trim());
  html = html.replace(/<div class="logo-strip">[\s\S]*?<\/div>/, newLogoStrip.trim());

  fs.writeFileSync(welcomeHtmlPath, html, 'utf8');
  fs.writeFileSync(path.join(process.cwd(), 'dist/welcome.html'), html, 'utf8');
  console.log('✓ Successfully embedded PNG logos at 1/3 width in public/welcome.html and dist/welcome.html');
}

main().catch(console.error);
