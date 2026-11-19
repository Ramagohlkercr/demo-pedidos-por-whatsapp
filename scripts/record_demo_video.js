const { chromium } = require('playwright');
const ffmpeg = require('ffmpeg-static');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const VIDEOS_DIR = path.join(__dirname, '..', 'public', 'videos');
const TEMP_DIR = path.join(VIDEOS_DIR, 'raw_recordings');

if (!fs.existsSync(VIDEOS_DIR)) fs.mkdirSync(VIDEOS_DIR, { recursive: true });
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

async function installVirtualCursor(page) {
  await page.evaluate(() => {
    if (document.getElementById('demo-virtual-cursor')) return;
    const cursor = document.createElement('div');
    cursor.id = 'demo-virtual-cursor';
    cursor.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      background: rgba(249, 115, 22, 0.9);
      border: 2.5px solid #ffffff;
      box-shadow: 0 4px 14px rgba(0,0,0,0.5);
      pointer-events: none;
      z-index: 99999999;
      transform: translate(-50%, -50%);
      transition: transform 0.12s cubic-bezier(0.16, 1, 0.3, 1), background 0.12s ease;
    `;
    document.body.appendChild(cursor);

    window.addEventListener('mousemove', (e) => {
      cursor.style.left = e.clientX + 'px';
      cursor.style.top = e.clientY + 'px';
    });

    window.createRipple = (x, y) => {
      const ripple = document.createElement('div');
      ripple.style.cssText = `
        position: fixed;
        left: ${x}px;
        top: ${y}px;
        width: 12px;
        height: 12px;
        border-radius: 50%;
        border: 2px solid #f97316;
        background: rgba(249, 115, 22, 0.45);
        pointer-events: none;
        z-index: 99999998;
        transform: translate(-50%, -50%) scale(1);
        transition: transform 0.45s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.45s ease-out;
      `;
      document.body.appendChild(ripple);
      requestAnimationFrame(() => {
        ripple.style.transform = 'translate(-50%, -50%) scale(5.5)';
        ripple.style.opacity = '0';
      });
      setTimeout(() => ripple.remove(), 500);
    };

    window.addEventListener('mousedown', (e) => {
      cursor.style.transform = 'translate(-50%, -50%) scale(0.65)';
      cursor.style.background = '#ea580c';
      window.createRipple(e.clientX, e.clientY);
    });

    window.addEventListener('mouseup', () => {
      cursor.style.transform = 'translate(-50%, -50%) scale(1)';
      cursor.style.background = 'rgba(249, 115, 22, 0.9)';
    });
  });
}

async function glideTo(page, targetX, targetY, steps = 18) {
  await page.mouse.move(targetX, targetY, { steps });
  await page.waitForTimeout(60);
}

async function smoothClick(page, locator, delay = 140) {
  try {
    await locator.scrollIntoViewIfNeeded({ timeout: 1500 });
  } catch (e) {}
  await page.waitForTimeout(50);

  const box = await locator.boundingBox().catch(() => null);
  if (box) {
    const x = Math.round(box.x + box.width / 2);
    const y = Math.round(box.y + box.height / 2);
    // Don't glide outside the 1280x720 window
    if (x >= 0 && x <= 1280 && y >= 0 && y <= 720) {
      await glideTo(page, x, y, 16);
      await page.waitForTimeout(delay);
      await page.evaluate(({ cx, cy }) => {
        if (window.createRipple) window.createRipple(cx, cy);
      }, { cx: x, cy: y }).catch(() => {});
    }
  }

  try {
    await locator.click({ timeout: 1500 });
  } catch (err) {
    await locator.evaluate(el => el.click()).catch(() => {});
  }
  await page.waitForTimeout(140);
}

async function smoothType(page, locator, text) {
  await smoothClick(page, locator, 100);
  try {
    await locator.fill('');
    await locator.type(text, { delay: 28 });
  } catch (e) {
    await locator.evaluate((el, val) => {
      el.value = val;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, text).catch(() => {});
  }
  await page.waitForTimeout(140);
}

// -------------------------------------------------------------
// SCENE 1: INTRO (1280x720, 3.8s)
// -------------------------------------------------------------
async function recordSceneIntro(browser) {
  console.log('[VIDEO] Grabando Escena 1: Intro comercial...');
  const dir = path.join(TEMP_DIR, 'intro');
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir, size: { width: 1280, height: 720 } }
  });
  const page = await context.newPage();
  await page.goto('http://localhost:3001/intro.html');
  await page.waitForTimeout(3800);

  await context.close();
  const file = fs.readdirSync(dir).find(f => f.endsWith('.webm'));
  return path.join(dir, file);
}

// -------------------------------------------------------------
// SCENE 2: MOBILE SHOWCASE (1280x720, Mockup Smartphone + Tarjetas)
// -------------------------------------------------------------
async function recordSceneShowcase(browser) {
  console.log('[VIDEO] Grabando Escena 2: Showcase Catálogo Móvil + Reglas de Negocio...');
  const dir = path.join(TEMP_DIR, 'showcase');
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir, size: { width: 1280, height: 720 } }
  });
  const page = await context.newPage();
  await page.goto('http://localhost:3001/showcase_frame.html');
  await page.waitForTimeout(1500);

  await installVirtualCursor(page);
  const frame = page.frameLocator('#appIframe');

  // Ocultar banner de demo para que se vea 100% de producción
  try {
    await frame.locator('.demo-banner').evaluate(el => el.style.display = 'none');
  } catch (e) {}

  // Esperar a que cargue el primer producto
  await frame.locator('.product-card').first().waitFor({ timeout: 6000 });

  // Paso 1: Catálogo móvil con fotos reales
  await page.evaluate(() => window.setActiveStep(1));
  await glideTo(page, 240, 180, 18);
  await page.waitForTimeout(500);

  // Filtrar por categoría "Cemento y Cal"
  const catBtn = frame.locator('.cat-pill:has-text("Cemento y Cal")').first();
  await smoothClick(page, catBtn, 150);
  await page.waitForTimeout(600);

  // Abrir modal de detalle de "Cemento Portland Loma Negra"
  const cementoImg = frame.locator('.product-card:has-text("Cemento Portland") .product-image-container').first();
  await smoothClick(page, cementoImg, 200);
  await page.waitForTimeout(800);

  // Seleccionar cantidad 10 en el modal
  const qtyInput = frame.locator('#modalQtyInput');
  await qtyInput.fill('10');
  await page.waitForTimeout(300);

  // Agregar al carrito desde el modal
  const btnModalAdd = frame.locator('#modalBtnAdd');
  await smoothClick(page, btnModalAdd, 180);
  await page.waitForTimeout(800);

  // Paso 2: Carrito con Reglas de Negocio
  await page.evaluate(() => window.setActiveStep(2));
  await page.waitForTimeout(400);

  // Agregar Arena Gruesa (categoría Áridos y Arenas)
  const aridosCat = frame.locator('.cat-pill:has-text("Áridos y Arenas")').first();
  await smoothClick(page, aridosCat, 150);
  await page.waitForTimeout(500);
  const arenaCard = frame.locator('.product-card:has-text("Arena Gruesa")').first();
  const arenaAddBtn = arenaCard.locator('.btn-add');
  await smoothClick(page, arenaAddBtn, 150);
  await page.waitForTimeout(600);

  // Agregar Hierro (categoría Hierros y Mallas)
  const hierroCat = frame.locator('.cat-pill:has-text("Hierros y Mallas")').first();
  await smoothClick(page, hierroCat, 150);
  await page.waitForTimeout(500);
  const hierroCard = frame.locator('.product-card:has-text("Hierro Conformado")').first();
  const hierroAddBtn = hierroCard.locator('.btn-add');
  await smoothClick(page, hierroAddBtn, 150);
  await page.waitForTimeout(700);

  // Abrir el Carrito (Bottom Sheet flotante)
  const openCartBtn = frame.locator('#btnOpenCart');
  await smoothClick(page, openCartBtn, 200);
  await page.waitForTimeout(800);

  // Scroll suave en el cuerpo del carrito para revelar formulario de entrega
  await frame.locator('#cartView .drawer-body').evaluate(el => el.scrollTo({ top: 320, behavior: 'smooth' }));
  await page.waitForTimeout(500);

  // Seleccionar modalidad "Envío a domicilio"
  const btnShipping = frame.locator('#btnDeliveryShipping');
  await smoothClick(page, btnShipping, 180);
  await page.waitForTimeout(500);

  // Scroll un poco más para ver selector de zonas
  await frame.locator('#cartView .drawer-body').evaluate(el => el.scrollTo({ top: 520, behavior: 'smooth' }));
  await page.waitForTimeout(400);

  // Seleccionar Zona de flete
  const selectZone = frame.locator('#shippingZoneSelect');
  await selectZone.selectOption('centro');
  await page.waitForTimeout(600);

  // Paso 3: Checkout directo a WhatsApp
  await page.evaluate(() => window.setActiveStep(3));
  await page.waitForTimeout(400);

  // Completar datos de entrega
  const inputName = frame.locator('#customerName');
  await smoothType(page, inputName, 'Mariano Rossi (Constructora Norte)');

  const inputPhone = frame.locator('#customerPhone');
  await smoothType(page, inputPhone, '+54 11 4455-6677');

  const inputAddress = frame.locator('#deliveryAddress');
  await smoothType(page, inputAddress, 'Av. Libertador 4200 (Obra Torre 4)');

  const inputNotes = frame.locator('#orderNotes');
  await smoothType(page, inputNotes, 'Descargar con grúa antes de las 14hs');

  // Enviar pedido
  const submitBtn = frame.locator('#btnSubmitOrder');
  await smoothClick(page, submitBtn, 250);
  await page.waitForTimeout(2200);

  // Vista de éxito con número correlativo y botón de WhatsApp
  const reopenBtn = frame.locator('#btnReopenWhatsApp');
  await reopenBtn.waitFor({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(2800);

  // Cerrar pantalla de éxito
  const closeSuccess = frame.locator('#btnCloseSuccess');
  await smoothClick(page, closeSuccess, 150);
  await page.waitForTimeout(600);

  // Paso 4: Repetir mi pedido en 1 toque
  await page.evaluate(() => window.setActiveStep(4));
  await page.waitForTimeout(400);

  const btnOpenRepeat = frame.locator('#btnOpenRepeatOrder');
  await smoothClick(page, btnOpenRepeat, 180);
  await page.waitForTimeout(600);

  const repeatPhoneInput = frame.locator('#repeatPhoneInput');
  await smoothType(page, repeatPhoneInput, '+54 11 4455-6677');
  const btnSearchRepeat = frame.locator('#btnSearchRepeatOrders');
  await smoothClick(page, btnSearchRepeat, 250);
  await page.waitForTimeout(2000);

  // Cerrar modal repeat
  const closeRepeatModal = frame.locator('#btnCloseRepeatOrder');
  await smoothClick(page, closeRepeatModal, 150);
  await page.waitForTimeout(700);

  await context.close();
  const file = fs.readdirSync(dir).find(f => f.endsWith('.webm'));
  return path.join(dir, file);
}

// -------------------------------------------------------------
// SCENE 3: TRANSICIÓN AL DEPÓSITO (1280x720, 3.5s)
// -------------------------------------------------------------
async function recordSceneTransition(browser) {
  console.log('[VIDEO] Grabando Escena 3: Transición a Depósito...');
  const dir = path.join(TEMP_DIR, 'transition');
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir, size: { width: 1280, height: 720 } }
  });
  const page = await context.newPage();
  await page.goto('http://localhost:3001/transicion_admin.html');
  await page.waitForTimeout(3600);

  await context.close();
  const file = fs.readdirSync(dir).find(f => f.endsWith('.webm'));
  return path.join(dir, file);
}

// -------------------------------------------------------------
// SCENE 4: PANEL DE CONTROL DESKTOP (1280x720, /admin + Remito + QR)
// -------------------------------------------------------------
async function recordSceneAdmin(browser) {
  console.log('[VIDEO] Grabando Escena 4: Panel Administrativo, Control de Stock, Remito y Métricas...');
  const dir = path.join(TEMP_DIR, 'admin');
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir, size: { width: 1280, height: 720 } }
  });
  const page = await context.newPage();
  await page.goto('http://localhost:3001/admin');
  await page.waitForTimeout(1000);

  await installVirtualCursor(page);

  // Si pide contraseña
  const passInput = page.locator('#adminPasswordInput');
  if (await passInput.isVisible({ timeout: 2500 }).catch(() => false)) {
    await smoothType(page, passInput, 'admin123');
    await smoothClick(page, page.locator('#loginForm button[type="submit"]'), 200);
    await page.waitForTimeout(1500);
  }

  // Inyectar banner superior corporativo
  await page.evaluate(() => {
    const banner = document.createElement('div');
    banner.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      background: #0b1329;
      color: #f8fafc;
      padding: 10px 24px;
      font-size: 0.92rem;
      font-weight: 700;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 2px solid #f97316;
      z-index: 99999;
      box-shadow: 0 4px 15px rgba(0,0,0,0.4);
    `;
    banner.innerHTML = `
      <div style="display: flex; align-items: center; gap: 10px;">
        <span style="background: #f97316; color: white; padding: 2px 10px; border-radius: 6px; font-size: 0.78rem;">EN VIVO</span>
        <span>PANEL DE CONTROL — Corralón & Distribuidora Norte</span>
      </div>
      <div style="font-size: 0.82rem; color: #94a3b8;">
        Recepción de pedidos por WhatsApp • Descuento de stock en tiempo real
      </div>
    `;
    document.body.prepend(banner);
    document.body.style.paddingTop = '45px';
  });

  await page.waitForTimeout(1000);

  // Mostrar el pedido recién ingresado
  const firstOrder = page.locator('.order-card').first();
  await firstOrder.waitFor({ timeout: 6000 });
  await smoothClick(page, firstOrder.locator('.btn-view-detail'), 200);
  await page.waitForTimeout(2000);

  // Cerrar slide-over de detalle
  const closeDetail = page.locator('#btnCloseOrderDetail');
  await smoothClick(page, closeDetail, 180);
  await page.waitForTimeout(600);

  // Cambiar estado a "Preparando"
  const statusSelect = firstOrder.locator('.status-select');
  await smoothClick(page, statusSelect, 180);
  await statusSelect.selectOption('Preparando');
  await page.waitForTimeout(1200);

  // Se abre modal de aviso de WhatsApp automático al cliente
  const waModal = page.locator('#whatsappNotifyModal');
  if (await waModal.isVisible({ timeout: 2000 }).catch(() => false)) {
    await page.waitForTimeout(2200);
    const closeNotify = page.locator('#btnCloseNotifyModal');
    await smoothClick(page, closeNotify, 180);
    await page.waitForTimeout(500);
  }

  // Cambiar estado a "Listo"
  await smoothClick(page, statusSelect, 150);
  await statusSelect.selectOption('Listo');
  await page.waitForTimeout(1000);
  if (await page.locator('#whatsappNotifyModal').isVisible({ timeout: 1000 }).catch(() => false)) {
    await page.locator('#btnCloseNotifyModal').click().catch(() => {});
  }

  // Ver Remito A4
  const remitoBtn = firstOrder.locator('a:has-text("Remito")');
  const remitoHref = await remitoBtn.getAttribute('href').catch(() => null);
  if (remitoHref) {
    await page.goto('http://localhost:3001' + remitoHref);
    await page.waitForTimeout(2500);
    // Scroll sutil para ver checklist y firmas
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(2200);
    await page.goto('http://localhost:3001/admin');
    await page.waitForTimeout(1000);
  }

  // Pestaña Métricas
  const tabMetrics = page.locator('#tabBtnMetrics');
  await tabMetrics.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  if (await tabMetrics.isVisible().catch(() => false)) {
    await smoothClick(page, tabMetrics, 200);
    await page.waitForTimeout(2400);
  }

  // Vista Mostrador QR
  await page.goto('http://localhost:3001/qr');
  await page.waitForTimeout(2600);

  await context.close();
  const file = fs.readdirSync(dir).find(f => f.endsWith('.webm'));
  return path.join(dir, file);
}

// -------------------------------------------------------------
// SCENE 5: OUTRO (1280x720, 4.2s)
// -------------------------------------------------------------
async function recordSceneOutro(browser) {
  console.log('[VIDEO] Grabando Escena 5: Cierre comercial y llamado a la acción...');
  const dir = path.join(TEMP_DIR, 'outro');
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir, size: { width: 1280, height: 720 } }
  });
  const page = await context.newPage();
  await page.goto('http://localhost:3001/outro.html');
  await page.waitForTimeout(4200);

  await context.close();
  const file = fs.readdirSync(dir).find(f => f.endsWith('.webm'));
  return path.join(dir, file);
}

// -------------------------------------------------------------
// VERTICAL VIDEO (9:16 - 430x932, Ideal para enviar por WhatsApp)
// -------------------------------------------------------------
async function recordMobileVertical(browser) {
  console.log('[VIDEO] Grabando Versión Vertical para WhatsApp (9:16)...');
  const dir = path.join(TEMP_DIR, 'vertical');
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  const context = await browser.newContext({
    viewport: { width: 430, height: 932 },
    deviceScaleFactor: 2,
    recordVideo: { dir, size: { width: 430, height: 932 } }
  });
  const page = await context.newPage();
  await page.goto('http://localhost:3001');
  await page.waitForTimeout(1500);

  await installVirtualCursor(page);

  // Ocultar demo banner
  try {
    await page.locator('.demo-banner').evaluate(el => el.style.display = 'none');
  } catch (e) {}

  // Recorrer catálogo
  await glideTo(page, 215, 200, 18);
  await page.mouse.wheel(0, 250);
  await page.waitForTimeout(600);

  // Clic en categoría Cemento y Cal
  const cat = page.locator('.cat-pill:has-text("Cemento y Cal")').first();
  await smoothClick(page, cat, 150);
  await page.waitForTimeout(600);

  // Abrir Cemento
  const prodCard = page.locator('.product-card:has-text("Cemento Portland")').first();
  await smoothClick(page, prodCard.locator('.product-image-container'), 180);
  await page.waitForTimeout(700);

  // Cantidad 10
  const qtyInput = page.locator('#modalQtyInput');
  await qtyInput.fill('10');
  await smoothClick(page, page.locator('#modalBtnAdd'), 180);
  await page.waitForTimeout(700);

  // Agregar Arena Gruesa
  const aridos = page.locator('.cat-pill:has-text("Áridos y Arenas")').first();
  await smoothClick(page, aridos, 150);
  await page.waitForTimeout(500);
  const arenaCard = page.locator('.product-card:has-text("Arena Gruesa")').first();
  const arenaAddBtn = arenaCard.locator('.btn-add');
  await smoothClick(page, arenaAddBtn, 150);
  await page.waitForTimeout(600);

  // Abrir carrito
  const openCartBtn = page.locator('#btnOpenCart');
  await smoothClick(page, openCartBtn, 200);
  await page.waitForTimeout(800);

  // Scroll suave en drawer
  await page.locator('#cartView .drawer-body').evaluate(el => el.scrollTo({ top: 320, behavior: 'smooth' }));
  await page.waitForTimeout(500);

  // Seleccionar flete
  const btnShipping = page.locator('#btnDeliveryShipping');
  await smoothClick(page, btnShipping, 150);
  await page.waitForTimeout(400);

  // Scroll a zonas
  await page.locator('#cartView .drawer-body').evaluate(el => el.scrollTo({ top: 520, behavior: 'smooth' }));
  await page.waitForTimeout(400);

  const zoneSelect = page.locator('#shippingZoneSelect');
  await zoneSelect.selectOption('centro');
  await page.waitForTimeout(500);

  // Completar datos
  await smoothType(page, page.locator('#customerName'), 'Mariano Rossi (Constructora)');
  await smoothType(page, page.locator('#customerPhone'), '+54 11 4455-6677');
  await smoothType(page, page.locator('#deliveryAddress'), 'Av. Libertador 4200 (Obra Torre 4)');
  await smoothType(page, page.locator('#orderNotes'), 'Descargar con grúa antes de las 14hs');

  // Enviar pedido
  await smoothClick(page, page.locator('#btnSubmitOrder'), 250);
  await page.waitForTimeout(2000);

  // Vista de éxito
  const reopenBtn = page.locator('#btnReopenWhatsApp');
  await reopenBtn.waitFor({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(3000);

  await context.close();
  const file = fs.readdirSync(dir).find(f => f.endsWith('.webm'));
  return path.join(dir, file);
}

// -------------------------------------------------------------
// POST-PRODUCCIÓN & EXPORTACIÓN MP4 CON FFMPEG
// -------------------------------------------------------------
async function compileVideos(clip1, clip2, clip3, clip4, clip5, clipVertical) {
  console.log('\n[FFMPEG] Iniciando compilación y encoding H.264...');

  // 1. Exportar versión vertical para WhatsApp
  const outVerticalMp4 = path.join(VIDEOS_DIR, 'demo_mobile_cliente.mp4');
  console.log('[FFMPEG] Generando demo_mobile_cliente.mp4...');
  execSync(`"${ffmpeg}" -y -i "${clipVertical}" -c:v libx264 -pix_fmt yuv420p -preset fast -crf 22 "${outVerticalMp4}"`, { stdio: 'inherit' });

  // 2. Convertir cada clip de 16:9 a MP4 intermedio
  const c1 = path.join(TEMP_DIR, 'c1.mp4');
  const c2 = path.join(TEMP_DIR, 'c2.mp4');
  const c3 = path.join(TEMP_DIR, 'c3.mp4');
  const c4 = path.join(TEMP_DIR, 'c4.mp4');
  const c5 = path.join(TEMP_DIR, 'c5.mp4');

  execSync(`"${ffmpeg}" -y -i "${clip1}" -c:v libx264 -pix_fmt yuv420p -r 30 -s 1280x720 "${c1}"`, { stdio: 'inherit' });
  execSync(`"${ffmpeg}" -y -i "${clip2}" -c:v libx264 -pix_fmt yuv420p -r 30 -s 1280x720 "${c2}"`, { stdio: 'inherit' });
  execSync(`"${ffmpeg}" -y -i "${clip3}" -c:v libx264 -pix_fmt yuv420p -r 30 -s 1280x720 "${c3}"`, { stdio: 'inherit' });
  execSync(`"${ffmpeg}" -y -i "${clip4}" -c:v libx264 -pix_fmt yuv420p -r 30 -s 1280x720 "${c4}"`, { stdio: 'inherit' });
  execSync(`"${ffmpeg}" -y -i "${clip5}" -c:v libx264 -pix_fmt yuv420p -r 30 -s 1280x720 "${c5}"`, { stdio: 'inherit' });

  // 3. Concatenar los 5 bloques en el video master 16:9
  const listFile = path.join(TEMP_DIR, 'concat_list.txt');
  fs.writeFileSync(listFile, `file '${c1}'\nfile '${c2}'\nfile '${c3}'\nfile '${c4}'\nfile '${c5}'\n`);

  const outMasterMp4 = path.join(VIDEOS_DIR, 'demo_pedidos_whatsapp.mp4');
  console.log('[FFMPEG] Concatenando video master demo_pedidos_whatsapp.mp4...');
  execSync(`"${ffmpeg}" -y -f concat -safe 0 -i "${listFile}" -c:v libx264 -pix_fmt yuv420p -preset fast -crf 21 -movflags +faststart "${outMasterMp4}"`, { stdio: 'inherit' });

  console.log('\n======================================================');
  console.log('[SUCCESS] ¡Videos generados con éxito!');
  console.log(`1. Master 16:9 Comercial:   ${outMasterMp4} (${(fs.statSync(outMasterMp4).size / (1024*1024)).toFixed(2)} MB)`);
  console.log(`2. Vertical para WhatsApp:   ${outVerticalMp4} (${(fs.statSync(outVerticalMp4).size / (1024*1024)).toFixed(2)} MB)`);
  console.log('======================================================\n');
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  try {
    const clip1 = await recordSceneIntro(browser);
    const clip2 = await recordSceneShowcase(browser);
    const clip3 = await recordSceneTransition(browser);
    const clip4 = await recordSceneAdmin(browser);
    const clip5 = await recordSceneOutro(browser);
    const clipVertical = await recordMobileVertical(browser);

    await browser.close();
    await compileVideos(clip1, clip2, clip3, clip4, clip5, clipVertical);

  } catch (err) {
    console.error('Error durante la grabación:', err);
    await browser.close().catch(() => {});
    process.exit(1);
  }
}

run();
