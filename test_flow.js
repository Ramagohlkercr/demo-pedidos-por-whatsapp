const http = require('http');
const fs = require('fs');

const PORT = 3002;
process.env.PORT = PORT;
process.env.ADMIN_PASSWORD = 'test_password_456';
process.env.STORE_NAME = 'Corralón San Cayetano';
process.env.WHATSAPP_PHONE = '5491199998888';

// Requerir el servidor
const { server } = require('./server');

function makeRequest(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '127.0.0.1',
      port: PORT,
      path: path,
      method: method,
      headers: {
        ...headers
      }
    };

    let payload = null;
    if (body) {
      if (typeof body === 'object') {
        payload = JSON.stringify(body);
        options.headers['Content-Type'] = 'application/json';
      } else {
        payload = body;
      }
      options.headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch (e) {}
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data,
          json
        });
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function runTests() {
  console.log('[TEST] Iniciando pruebas automáticas de flujo completo...');
  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  [OK] ${message}`);
      passed++;
    } else {
      console.error(`  [FAIL] FALLÓ: ${message}`);
      failed++;
    }
  }

  try {
    // 1. Probar carga de assets estáticos
    const home = await makeRequest('GET', '/');
    assert(home.statusCode === 200 && home.data.includes('Pedidos por WhatsApp'), 'GET / carga el catálogo HTML');

    const adminPage = await makeRequest('GET', '/admin');
    assert(adminPage.statusCode === 200 && adminPage.data.includes('Panel de Control'), 'GET /admin carga el panel HTML');

    // 2. Configuración pública
    const configRes = await makeRequest('GET', '/api/config');
    assert(configRes.statusCode === 200, 'GET /api/config responde 200');
    assert(configRes.json.storeName === 'Corralón San Cayetano', 'Config refleja STORE_NAME de variables');
    assert(configRes.json.whatsappPhone === '5491199998888', 'Config refleja WHATSAPP_PHONE');
    assert(!configRes.json.adminPassword, 'Config pública NO filtra la clave admin');

    // 3. Catálogo de productos
    const prodsRes = await makeRequest('GET', '/api/products');
    assert(prodsRes.statusCode === 200, 'GET /api/products responde 200');
    assert(prodsRes.json.products.length >= 15, `Se sembraron ${prodsRes.json.products.length} productos (esperado >= 15)`);
    assert(prodsRes.json.categories.length >= 4, `Categorías detectadas: ${prodsRes.json.categories.join(', ')}`);

    const cemento = prodsRes.json.products.find(p => p.name.includes('Cemento Portland'));
    const arena = prodsRes.json.products.find(p => p.name.includes('Arena Gruesa'));
    assert(cemento && arena, 'Existen productos esenciales (Cemento y Arena)');

    // 4. Crear un pedido (Checkout)
    const orderPayload = {
      customerName: 'Carlos Bianchi',
      customerPhone: '11 4455-6677',
      deliveryType: 'envio',
      deliveryAddress: 'Av. Corrientes 1234, CABA (piso 4 obra)',
      notes: 'Llamar antes de entregar',
      items: [
        { productId: cemento.id, quantity: 10 },
        { productId: arena.id, quantity: 2 }
      ]
    };

    const orderRes = await makeRequest('POST', '/api/orders', orderPayload);
    assert(orderRes.statusCode === 200, 'POST /api/orders responde 200');
    assert(orderRes.json.success === true, 'Pedido guardado con éxito');
    assert(orderRes.json.orderNumber >= 1001, `Número de pedido correlativo generado: #${orderRes.json.orderNumber}`);
    assert(orderRes.json.whatsappUrl.includes('https://wa.me/5491199998888'), 'URL de WhatsApp apunta al número del negocio');
    assert(orderRes.json.whatsappUrl.includes(encodeURIComponent('Carlos Bianchi')), 'Mensaje incluye nombre del cliente');
    assert(orderRes.json.whatsappUrl.includes(encodeURIComponent(orderRes.json.orderNumber)), 'Mensaje incluye número correlativo');

    const createdOrderId = orderRes.json.orderId;

    // 5. Autenticación Admin
    const badLogin = await makeRequest('POST', '/api/admin/login', { password: 'wrong' });
    assert(badLogin.statusCode === 401, 'Login con clave incorrecta es rechazado (401)');

    const goodLogin = await makeRequest('POST', '/api/admin/login', { password: 'test_password_456' });
    assert(goodLogin.statusCode === 200, 'Login con clave correcta es aceptado (200)');
    
    // Extraer cookie de sesión
    const setCookie = goodLogin.headers['set-cookie'];
    assert(setCookie && setCookie.length > 0, 'Se generó cookie de sesión admin');
    const authCookieHeader = setCookie[0].split(';')[0];

    const checkAuthRes = await makeRequest('GET', '/api/admin/check-auth', null, { 'Cookie': authCookieHeader });
    assert(checkAuthRes.json.authenticated === true, 'Check-auth reconoce sesión activa');

    // 6. Consultar pedidos en Admin
    const adminOrders = await makeRequest('GET', '/api/admin/orders', null, { 'Cookie': authCookieHeader });
    assert(adminOrders.statusCode === 200, 'GET /api/admin/orders responde 200 con auth');
    const myOrder = adminOrders.json.orders.find(o => o.id === createdOrderId);
    assert(myOrder !== undefined, 'El pedido creado figura en la lista del panel');
    assert(myOrder.status === 'Nuevo', 'El estado inicial del pedido es "Nuevo"');
    assert(myOrder.items.length === 2, 'El pedido contiene los 2 ítems detallados');

    // 7. Cambio de estado en 1 click
    const updateStatus = await makeRequest('PATCH', `/api/admin/orders/${createdOrderId}/status`, { status: 'Preparando' }, { 'Cookie': authCookieHeader });
    assert(updateStatus.statusCode === 200, 'PATCH /api/admin/orders/:id/status actualiza a "Preparando"');

    const updateStatusReady = await makeRequest('PATCH', `/api/admin/orders/${createdOrderId}/status`, { status: 'Entregado' }, { 'Cookie': authCookieHeader });
    assert(updateStatusReady.statusCode === 200, 'PATCH status actualiza a "Entregado"');

    // 8. CRUD de Productos
    const newProd = await makeRequest('POST', '/api/admin/products', {
      name: 'Vigueta Pretensada 4.00 m',
      category: 'Techos',
      unit: 'unidad',
      price: 21500,
      stock: 40,
      is_active: 1,
      is_out_of_stock: 0
    }, { 'Cookie': authCookieHeader });
    assert(newProd.statusCode === 200, 'POST /api/admin/products crea un producto nuevo');
    const newProdId = newProd.json.id;

    // Modificar y marcar sin stock
    const updateProd = await makeRequest('PUT', `/api/admin/products/${newProdId}`, {
      name: 'Vigueta Pretensada 4.00 m Reforzada',
      category: 'Techos',
      unit: 'unidad',
      price: 23000,
      stock: 0,
      is_active: 1,
      is_out_of_stock: 1
    }, { 'Cookie': authCookieHeader });
    assert(updateProd.statusCode === 200, 'PUT /api/admin/products/:id actualiza precio y sin stock');

    // 9. Importar CSV
    const csvContent = `nombre,categoria,unidad,precio,stock
Malla Sima 15x15 6mm pesada,Hierros y Mallas,unidad,38000,50
Membrana Geotextil 4mm,Impermeabilizaciones,rollo,52000,20`;

    const csvRes = await makeRequest('POST', '/api/admin/products/import-csv', { csvText: csvContent }, { 'Cookie': authCookieHeader });
    assert(csvRes.statusCode === 200, 'POST /api/admin/products/import-csv importa texto CSV');
    assert(csvRes.json.count === 2, `Se importaron exactamente 2 productos vía CSV (reportado: ${csvRes.json.count})`);

    // -----------------------------------------------------------------
    // 10. SEGURIDAD Y VALIDACIONES NUEVAS
    // -----------------------------------------------------------------

    // 10.1 XSS en remito.html
    const remitoHtml = fs.readFileSync('./public/remito.html', 'utf8');
    assert(remitoHtml.includes('function escapeHtml(str)'), 'remito.html define función escapeHtml');
    assert(remitoHtml.includes('${escapeHtml(order.customer_name)}'), 'remito.html escapa customer_name con escapeHtml');
    assert(remitoHtml.includes('${escapeHtml(item.product_name)}'), 'remito.html escapa item.product_name con escapeHtml');
    assert(remitoHtml.includes('${escapeHtml(order.delivery_address)}'), 'remito.html escapa delivery_address con escapeHtml');

    // 10.2 Privacidad: GET /api/customer/orders
    const shortPhoneRes = await makeRequest('GET', '/api/customer/orders?phone=12345');
    assert(shortPhoneRes.statusCode === 400, 'GET /api/customer/orders exige teléfono completo de al menos 8 dígitos (400 con 5 dígitos)');

    const custOrdersRes = await makeRequest('GET', '/api/customer/orders?phone=1144556677');
    assert(custOrdersRes.statusCode === 200, 'GET /api/customer/orders responde 200 con teléfono válido');
    assert(Array.isArray(custOrdersRes.json.orders) && custOrdersRes.json.orders.length <= 3, 'GET /api/customer/orders retorna máximo 3 resultados');
    
    if (custOrdersRes.json.orders.length > 0) {
      const firstCustOrder = custOrdersRes.json.orders[0];
      assert(firstCustOrder.id && firstCustOrder.order_number && firstCustOrder.status && firstCustOrder.totalFormatted, 'Pedido de cliente incluye número, estado y total');
      assert(firstCustOrder.customer_name === undefined, 'Pedido de cliente NO expone nombre del cliente');
      assert(firstCustOrder.customer_phone === undefined, 'Pedido de cliente NO expone teléfono del cliente');
      assert(firstCustOrder.delivery_address === undefined, 'Pedido de cliente NO expone dirección del cliente');
      assert(firstCustOrder.notes === undefined, 'Pedido de cliente NO expone observaciones privadas');
    }

    // 10.3 Privacidad: POST /api/customer/repeat-order
    const repeatWrongPhone = await makeRequest('POST', '/api/customer/repeat-order', {
      orderId: createdOrderId,
      phone: '1199999999' // Teléfono que no coincide
    });
    assert(repeatWrongPhone.statusCode === 403, 'POST /api/customer/repeat-order rechaza teléfono no coincidente con 403');

    const repeatCorrectPhone = await makeRequest('POST', '/api/customer/repeat-order', {
      orderId: createdOrderId,
      phone: '1144556677' // Teléfono correcto
    });
    assert(repeatCorrectPhone.statusCode === 200, 'POST /api/customer/repeat-order acepta teléfono coincidente (200)');
    assert(repeatCorrectPhone.json.success === true && Array.isArray(repeatCorrectPhone.json.items), 'Devuelve lista de ítems disponibles');
    assert(repeatCorrectPhone.json.order === undefined, 'NO devuelve el objeto order completo para proteger privacidad');

    // 10.3 Validación de teléfono en servidor (XSS y formato seguro)
    const quotePhoneOrder = await makeRequest('POST', '/api/orders', {
      customerName: 'Cliente XSS',
      customerPhone: '11 4455"6677',
      deliveryType: 'retiro',
      items: [{ productId: cemento.id, quantity: 1 }]
    });
    assert(quotePhoneOrder.statusCode === 400, 'POST /api/orders con comillas en teléfono responde 400');
    assert(quotePhoneOrder.json && quotePhoneOrder.json.error === 'Ingresá un teléfono válido (solo números, espacios, + y -)', 'Mensaje exacto para teléfono con comillas/caracteres no permitidos');

    const scriptPhoneOrder = await makeRequest('POST', '/api/orders', {
      customerName: 'Cliente XSS',
      customerPhone: '<script>alert(1)</script>',
      deliveryType: 'retiro',
      items: [{ productId: cemento.id, quantity: 1 }]
    });
    assert(scriptPhoneOrder.statusCode === 400, 'POST /api/orders con script en teléfono responde 400');

    const shortPhoneOrder = await makeRequest('POST', '/api/orders', {
      customerName: 'Cliente Corto',
      customerPhone: '12345',
      deliveryType: 'retiro',
      items: [{ productId: cemento.id, quantity: 1 }]
    });
    assert(shortPhoneOrder.statusCode === 400, 'POST /api/orders con teléfono de menos de 8 caracteres responde 400');

    const validFormattedPhone = await makeRequest('POST', '/api/orders', {
      customerName: 'Cliente Tel Formato',
      customerPhone: '+54 (11) 4455-6677',
      deliveryType: 'retiro',
      items: [{ productId: cemento.id, quantity: 1 }]
    }, { 'X-Forwarded-For': '198.51.100.88' });
    assert(validFormattedPhone.statusCode === 200, 'POST /api/orders acepta formato de teléfono con +, (), - y espacios');

    // 10.4 Validaciones estrictas de Stock en POST /api/orders
    // Producto marcado sin stock (usamos el producto id: newProdId que pusimos is_out_of_stock = 1)
    const outOfStockOrder = await makeRequest('POST', '/api/orders', {
      customerName: 'Cliente Test',
      customerPhone: '1122334455',
      deliveryType: 'retiro',
      items: [{ productId: newProdId, quantity: 1 }]
    });
    assert(outOfStockOrder.statusCode === 400, 'POST /api/orders rechaza productos con is_out_of_stock = 1 con 400');

    // Cantidad no numérica
    const nanQtyOrder = await makeRequest('POST', '/api/orders', {
      customerName: 'Cliente Test',
      customerPhone: '1122334455',
      deliveryType: 'retiro',
      items: [{ productId: cemento.id, quantity: "cinco_bolsas" }]
    });
    assert(nanQtyOrder.statusCode === 400, 'POST /api/orders rechaza cantidad que no es número con 400');

    // Cantidad <= 0
    const zeroQtyOrder = await makeRequest('POST', '/api/orders', {
      customerName: 'Cliente Test',
      customerPhone: '1122334455',
      deliveryType: 'retiro',
      items: [{ productId: cemento.id, quantity: 0 }]
    });
    assert(zeroQtyOrder.statusCode === 400, 'POST /api/orders rechaza cantidad <= 0 con 400');

    // Cantidad excesiva (> 10000)
    const excessiveQtyOrder = await makeRequest('POST', '/api/orders', {
      customerName: 'Cliente Test',
      customerPhone: '1122334455',
      deliveryType: 'retiro',
      items: [{ productId: cemento.id, quantity: 99999 }]
    });
    assert(excessiveQtyOrder.statusCode === 400, 'POST /api/orders rechaza cantidad > 10.000 con 400');

    // Cantidad superior al stock disponible
    const overStockOrder = await makeRequest('POST', '/api/orders', {
      customerName: 'Cliente Test',
      customerPhone: '1122334455',
      deliveryType: 'retiro',
      items: [{ productId: cemento.id, quantity: cemento.stock + 500 }]
    });
    assert(overStockOrder.statusCode === 400, 'POST /api/orders rechaza cantidad mayor al stock disponible con 400');

    // 10.5 Reposición de Stock en Cancelación o Vuelta a Nuevo
    // Creamos un producto con stock 50 para prueba de stock
    const stockTestProd = await makeRequest('POST', '/api/admin/products', {
      name: 'Piedra Test Stock',
      category: 'Áridos y Arenas',
      unit: 'm3',
      price: 15000,
      stock: 50,
      is_active: 1
    }, { 'Cookie': authCookieHeader });
    const stockTestProdId = stockTestProd.json.id;

    // Crear pedido con 10 unidades
    const stockOrderRes = await makeRequest('POST', '/api/orders', {
      customerName: 'Pedro Stock',
      customerPhone: '1133445566',
      deliveryType: 'retiro',
      items: [{ productId: stockTestProdId, quantity: 10 }]
    });
    assert(stockOrderRes.statusCode === 200, 'Pedido de prueba de stock creado');
    const stockOrderId = stockOrderRes.json.orderId;

    // Pasar a "Preparando" -> debe descontar stock de 50 a 40
    await makeRequest('PATCH', `/api/admin/orders/${stockOrderId}/status`, { status: 'Preparando' }, { 'Cookie': authCookieHeader });
    const prodsAfterDeduct = await makeRequest('GET', '/api/products');
    const prodAfterDeduct = prodsAfterDeduct.json.products.find(p => p.id === stockTestProdId);
    assert(prodAfterDeduct.stock === 40, `Stock descontado al pasar a "Preparando" (esperado: 40, actual: ${prodAfterDeduct?.stock})`);

    // Pasar a "Cancelado" -> debe reponer stock de 40 a 50
    await makeRequest('PATCH', `/api/admin/orders/${stockOrderId}/status`, { status: 'Cancelado' }, { 'Cookie': authCookieHeader });
    const prodsAfterCancel = await makeRequest('GET', '/api/products');
    const prodAfterCancel = prodsAfterCancel.json.products.find(p => p.id === stockTestProdId);
    assert(prodAfterCancel.stock === 50, `Stock repuesto al pasar a "Cancelado" (esperado: 50, actual: ${prodAfterCancel?.stock})`);

    // Volver a "Preparando" -> descuenta a 40
    await makeRequest('PATCH', `/api/admin/orders/${stockOrderId}/status`, { status: 'Preparando' }, { 'Cookie': authCookieHeader });
    // Volver a "Nuevo" -> debe reponer stock a 50
    await makeRequest('PATCH', `/api/admin/orders/${stockOrderId}/status`, { status: 'Nuevo' }, { 'Cookie': authCookieHeader });
    const prodsAfterNuevo = await makeRequest('GET', '/api/products');
    const prodAfterNuevo = prodsAfterNuevo.json.products.find(p => p.id === stockTestProdId);
    assert(prodAfterNuevo.stock === 50, `Stock repuesto al volver de "Preparando" a "Nuevo" (esperado: 50, actual: ${prodAfterNuevo?.stock})`);

    // 10.6 Validaciones menores de productos: precio <= 0 o stock negativo
    const zeroPriceProd = await makeRequest('POST', '/api/admin/products', {
      name: 'Producto Precio Cero',
      category: 'General',
      price: 0,
      stock: 10
    }, { 'Cookie': authCookieHeader });
    assert(zeroPriceProd.statusCode === 400, 'POST /api/admin/products rechaza precio <= 0 con 400');

    const negStockProd = await makeRequest('POST', '/api/admin/products', {
      name: 'Producto Stock Negativo',
      category: 'General',
      price: 1000,
      stock: -5
    }, { 'Cookie': authCookieHeader });
    assert(negStockProd.statusCode === 400, 'POST /api/admin/products rechaza stock negativo con 400');

    const updateNegPrice = await makeRequest('PUT', `/api/admin/products/${newProdId}`, {
      name: 'Producto Update Negativo',
      category: 'General',
      unit: 'unidad',
      price: -100,
      stock: 10
    }, { 'Cookie': authCookieHeader });
    assert(updateNegPrice.statusCode === 400, 'PUT /api/admin/products/:id rechaza precio <= 0 con 400');

    // 10.7 Validación de subida de imagen (solo JPG, PNG, WebP)
    const boundary = '----TestBoundary' + Math.random().toString(36).substring(2);
    const badUploadPayload = `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="script.exe"\r\nContent-Type: application/octet-stream\r\n\r\nMALICIOUS_BYTES\r\n--${boundary}--\r\n`;
    const badUploadRes = await makeRequest('POST', '/api/admin/upload-image', badUploadPayload, {
      'Cookie': authCookieHeader,
      'Content-Type': `multipart/form-data; boundary=${boundary}`
    });
    assert(badUploadRes.statusCode === 400, 'upload-image rechaza extensiones y MIME no permitidos (.exe con 400)');

    // 10.8 Mitigación de inyección de fórmulas CSV
    // Creamos un pedido con cliente cuya celda empieza con signo de fórmula
    const formulaOrder = await makeRequest('POST', '/api/orders', {
      customerName: '=SUM(1,2)',
      customerPhone: '+5491133334444',
      deliveryType: 'retiro',
      notes: '-10% descuento especial',
      items: [{ productId: cemento.id, quantity: 1 }]
    });
    assert(formulaOrder.statusCode === 200, 'Pedido con caracteres de fórmula creado');
    const csvExportRes = await makeRequest('GET', '/api/admin/orders/export-csv', null, { 'Cookie': authCookieHeader });
    assert(csvExportRes.statusCode === 200, 'GET /api/admin/orders/export-csv responde 200');
    assert(csvExportRes.data.includes("''=SUM(1,2)") || csvExportRes.data.includes("'=SUM(1,2)"), 'CSV export antepone comilla simple a celdas que inician con =');
    assert(csvExportRes.data.includes("'+5491133334444"), 'CSV export antepone comilla simple a celdas que inician con +');
    assert(csvExportRes.data.includes("'-10%"), 'CSV export antepone comilla simple a celdas que inician con -');

    // 10.9 Antispam: Límite de 5 pedidos por IP cada 10 min
    // Ya enviamos 3 pedidos exitosos en el flujo:
    // (1) orderPayload, (2) stockOrderRes, (3) formulaOrder.
    // Enviamos el 4to y 5to pedido exitosos:
    const p4 = await makeRequest('POST', '/api/orders', {
      customerName: 'Cliente Cuarto',
      customerPhone: '1155556664',
      deliveryType: 'retiro',
      items: [{ productId: cemento.id, quantity: 1 }]
    });
    assert(p4.statusCode === 200, '4to pedido procesado con éxito (200)');

    const p5 = await makeRequest('POST', '/api/orders', {
      customerName: 'Cliente Quinto',
      customerPhone: '1155556665',
      deliveryType: 'retiro',
      items: [{ productId: cemento.id, quantity: 1 }]
    });
    assert(p5.statusCode === 200, '5to pedido procesado con éxito (límite alcanzado: 5)');

    // El 6to pedido debe ser bloqueado con HTTP 429
    const p6 = await makeRequest('POST', '/api/orders', {
      customerName: 'Cliente Sexto',
      customerPhone: '1166667777',
      deliveryType: 'retiro',
      items: [{ productId: cemento.id, quantity: 1 }]
    });
    assert(p6.statusCode === 429, 'POST /api/orders responde 429 al superar el límite de 5 pedidos por IP');
    assert(p6.json && p6.json.error && p6.json.error.includes('Límite de pedidos alcanzado'), 'Respuesta 429 contiene mensaje en español');

    // 10.9.1 Rate limiting detrás de proxy (Render / trust proxy con X-Forwarded-For)
    // IP A (203.0.113.10): Envía 5 pedidos y alcanza su límite individual
    for (let i = 1; i <= 5; i++) {
      const resA = await makeRequest('POST', '/api/orders', {
        customerName: `Cliente Proxy A ${i}`,
        customerPhone: `117700100${i}`,
        deliveryType: 'retiro',
        items: [{ productId: cemento.id, quantity: 1 }]
      }, { 'X-Forwarded-For': '203.0.113.10' });
      assert(resA.statusCode === 200, `Pedido ${i} de IP A (203.0.113.10) procesado con éxito (200)`);
    }

    // El 6to pedido desde IP A debe recibir 429
    const resA6 = await makeRequest('POST', '/api/orders', {
      customerName: 'Cliente Proxy A 6',
      customerPhone: '1177001006',
      deliveryType: 'retiro',
      items: [{ productId: cemento.id, quantity: 1 }]
    }, { 'X-Forwarded-For': '203.0.113.10' });
    assert(resA6.statusCode === 429, 'IP A (203.0.113.10) supera el límite de 5 pedidos y recibe 429');

    // Un pedido desde una IP B distinta (203.0.113.20): NO comparte el límite de IP A y responde 200
    const resB = await makeRequest('POST', '/api/orders', {
      customerName: 'Cliente Proxy B',
      customerPhone: '1177002001',
      deliveryType: 'retiro',
      items: [{ productId: cemento.id, quantity: 1 }]
    }, { 'X-Forwarded-For': '203.0.113.20' });
    assert(resB.statusCode === 200, 'Dos pedidos con X-Forwarded-For distintos no comparten el límite: IP B responde 200');

    // 10.10 Antispam: Límite de 10 intentos de login en 15 min
    // Ya usamos 2 intentos antes (badLogin y goodLogin). Hacemos 8 intentos más para llegar a 10:
    for (let i = 0; i < 8; i++) {
      await makeRequest('POST', '/api/admin/login', { password: 'wrong' });
    }
    // El intento 11 debe ser bloqueado con 429
    const login11 = await makeRequest('POST', '/api/admin/login', { password: 'wrong' });
    assert(login11.statusCode === 429, 'POST /api/admin/login responde 429 al superar 10 intentos');
    assert(login11.json && login11.json.error && login11.json.error.includes('Demasiados intentos'), 'Respuesta 429 de login contiene mensaje en español');

    // Limpieza de datos temporales de prueba en la base
    const { db: testDb } = require('./database');
    testDb.prepare('DELETE FROM products WHERE id > 26').run();
    testDb.prepare("DELETE FROM orders WHERE customer_name LIKE 'Cliente%'").run();
    testDb.prepare("DELETE FROM order_items WHERE order_id NOT IN (SELECT id FROM orders)").run();

    // 11. Resumen final
    console.log(`\n========================================`);
    console.log(`[TEST] RESULTADO: ${passed} exitosas, ${failed} fallidas.`);
    console.log(`========================================\n`);

    if (failed === 0) {
      console.log('[TEST] ¡Todas las pruebas pasaron satisfactoriamente!');
      process.exit(0);
    } else {
      process.exit(1);
    }

  } catch (err) {
    console.error('Error fatal durante las pruebas:', err);
    process.exit(1);
  }
}

// Darle 500ms al servidor para arrancar y correr tests
setTimeout(runTests, 500);
