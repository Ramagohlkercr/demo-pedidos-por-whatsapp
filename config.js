require('dotenv').config();

module.exports = {
  PORT: process.env.PORT || 3001,
  
  // Configuración de marca y negocio (re-marcable)
  STORE_NAME: process.env.STORE_NAME || "Corralón & Distribuidora Norte",
  STORE_TAGLINE: process.env.STORE_TAGLINE || "Materiales de Construcción • Venta Mayorista y Minorista",
  STORE_LOGO: process.env.STORE_LOGO || "", // URL o path relativo a /public
  PRIMARY_COLOR: process.env.PRIMARY_COLOR || "#f97316", // Naranja corralón / construcción
  SECONDARY_COLOR: process.env.SECONDARY_COLOR || "#0f172a", // Azul pizarra oscuro
  
  // Teléfono WhatsApp en formato internacional (sin +, sin espacios)
  // Ej: 5491112345678 (Argentina: 54 + 9 + código de área sin 0 + número sin 15)
  WHATSAPP_PHONE: process.env.WHATSAPP_PHONE || "5491123456789",
  
  // Clave para ingresar al panel de administración (/admin)
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || "admin123",
  
  // Base de datos SQLite
  DATABASE_PATH: process.env.DATABASE_PATH || "./pedidos.db",
  
  // Moneda
  CURRENCY_SYMBOL: "$",
  LOCALE: "es-AR",

  // Horario de atención comercial (para indicador Abierto/Cerrado)
  BUSINESS_OPEN_TIME: process.env.BUSINESS_OPEN_TIME || "08:00",
  BUSINESS_CLOSE_TIME: process.env.BUSINESS_CLOSE_TIME || "18:00",
  BUSINESS_SATURDAY_CLOSE_TIME: process.env.BUSINESS_SATURDAY_CLOSE_TIME || "13:00",
  BUSINESS_HOURS_TEXT: process.env.BUSINESS_HOURS_TEXT || "Lun a Vie 08:00 a 18:00 | Sáb 08:00 a 13:00",

  // Reglas comerciales: Pedido mínimo y Zonas de envío
  MIN_ORDER_AMOUNT: parseInt(process.env.MIN_ORDER_AMOUNT || "15000", 10),
  AUTO_DEDUCT_STOCK: process.env.AUTO_DEDUCT_STOCK !== 'false',
  SHIPPING_ZONES: [
    { id: 'centro', name: 'Radio céntrico / hasta 5 km', price: 4500 },
    { id: 'intermedio', name: 'Zona Obra Media (5 a 15 km)', price: 8500 },
    { id: 'periferia', name: 'Zona Periférica / Gran porte (15 a 30 km)', price: 14000 },
    { id: 'coordinar', name: 'Flete con grúa / A coordinar con el local', price: 0 }
  ]
};
