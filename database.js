const Database = require('better-sqlite3');
const path = require('path');
const config = require('./config');

const dbPath = path.resolve(config.DATABASE_PATH);
const db = new Database(dbPath);

// Optimizaciones SQLite
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Inicializar tablas
function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      unit TEXT NOT NULL DEFAULT 'unidad',
      price REAL NOT NULL,
      stock INTEGER NOT NULL DEFAULT 100,
      is_active INTEGER NOT NULL DEFAULT 1,
      is_out_of_stock INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_number INTEGER NOT NULL UNIQUE,
      customer_name TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      delivery_type TEXT NOT NULL, -- 'retiro' o 'envio'
      delivery_address TEXT,
      notes TEXT,
      total REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'Nuevo', -- 'Nuevo', 'Preparando', 'Listo', 'Entregado', 'Cancelado'
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      product_id INTEGER,
      product_name TEXT NOT NULL,
      unit TEXT NOT NULL,
      unit_price REAL NOT NULL,
      quantity REAL NOT NULL,
      subtotal REAL NOT NULL,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    CREATE INDEX IF NOT EXISTS idx_orders_number ON orders(order_number);
  `);

  // Migración suave: agregar image_url si no existe
  try {
    db.prepare('SELECT image_url FROM products LIMIT 1').get();
  } catch (e) {
    try {
      db.exec('ALTER TABLE products ADD COLUMN image_url TEXT');
    } catch (err) {}
  }

  // Migración suave: agregar is_featured si no existe
  try {
    db.prepare('SELECT is_featured FROM products LIMIT 1').get();
  } catch (e) {
    try {
      db.exec('ALTER TABLE products ADD COLUMN is_featured INTEGER DEFAULT 0');
      db.exec("UPDATE products SET is_featured = 1 WHERE name LIKE '%Cemento%' OR name LIKE '%Arena%' OR name LIKE '%Ladrillo Hueco 12%' OR name LIKE '%Hierro Conformado ADN 420 Ø 8%'");
    } catch (err) {}
  }

  // Migración suave: agregar shipping_zone y subtotal a orders
  try {
    db.prepare('SELECT shipping_zone FROM orders LIMIT 1').get();
  } catch (e) {
    try {
      db.exec('ALTER TABLE orders ADD COLUMN shipping_zone TEXT');
      db.exec('ALTER TABLE orders ADD COLUMN shipping_cost REAL DEFAULT 0');
      db.exec('ALTER TABLE orders ADD COLUMN subtotal REAL');
    } catch (err) {}
  }

  // Migración suave: stock mínimo y control de descuento automático
  try {
    db.prepare('SELECT min_stock FROM products LIMIT 1').get();
  } catch (e) {
    try {
      db.exec('ALTER TABLE products ADD COLUMN min_stock INTEGER DEFAULT 10');
    } catch (err) {}
  }

  try {
    db.prepare('SELECT stock_deducted FROM orders LIMIT 1').get();
  } catch (e) {
    try {
      db.exec('ALTER TABLE orders ADD COLUMN stock_deducted INTEGER DEFAULT 0');
    } catch (err) {}
  }

  // Seed de datos si está vacía
  seedInitialProducts();
}

function seedInitialProducts() {
  const count = db.prepare('SELECT COUNT(*) as count FROM products').get().count;
  if (count === 0) {
    console.log('[DB] Poblando base de datos con productos típicos de corralón...');
    const insert = db.prepare(`
      INSERT INTO products (name, category, unit, price, stock, is_active, is_out_of_stock, image_url, is_featured, min_stock)
      VALUES (@name, @category, @unit, @price, @stock, 1, @is_out_of_stock, @image_url, @is_featured, @min_stock)
    `);

    const initialProducts = [
      { name: "Cemento Portland Loma Negra (50 kg)", category: "Cemento y Cal", unit: "bolsa", price: 9800, stock: 150, is_out_of_stock: 0, image_url: "/img/products/cemento-portland-50kg.webp", is_featured: 1, min_stock: 20 },
      { name: "Cal Hidratada Cacique (25 kg)", category: "Cemento y Cal", unit: "bolsa", price: 4200, stock: 200, is_out_of_stock: 0, image_url: "/img/products/cal-hidratada-25kg.webp", is_featured: 0, min_stock: 25 },
      { name: "Cemento de Albañilería Plasticor (40 kg)", category: "Cemento y Cal", unit: "bolsa", price: 7500, stock: 90, is_out_of_stock: 0, image_url: "/img/products/cemento-albanileria-40kg.webp", is_featured: 0, min_stock: 15 },
      { name: "Arena Gruesa de Río Lavada", category: "Áridos y Arenas", unit: "m3", price: 28500, stock: 45, is_out_of_stock: 0, image_url: "/img/products/arena-gruesa.webp", is_featured: 1, min_stock: 10 },
      { name: "Arena Fina para Revoque", category: "Áridos y Arenas", unit: "m3", price: 31000, stock: 30, is_out_of_stock: 0, image_url: "/img/products/arena-fina.webp", is_featured: 0, min_stock: 8 },
      { name: "Piedra Partida Granítica 6-20", category: "Áridos y Arenas", unit: "m3", price: 42000, stock: 25, is_out_of_stock: 0, image_url: "/img/products/piedra-partida.webp", is_featured: 0, min_stock: 6 },
      { name: "Cascote Picado Limpio", category: "Áridos y Arenas", unit: "m3", price: 22000, stock: 15, is_out_of_stock: 0, image_url: "/img/products/cascote-picado.webp", is_featured: 0, min_stock: 5 },
      { name: "Ladrillo Hueco 12x18x33 (6 tubos)", category: "Ladrillos y Bloques", unit: "unidad", price: 680, stock: 1500, is_out_of_stock: 0, image_url: "/img/products/ladrillo-hueco-12x18x33.webp", is_featured: 1, min_stock: 300 },
      { name: "Ladrillo Hueco 18x18x33 (9 tubos portante)", category: "Ladrillos y Bloques", unit: "unidad", price: 890, stock: 1200, is_out_of_stock: 0, image_url: "/img/products/ladrillo-hueco-18x18x33.webp", is_featured: 0, min_stock: 200 },
      { name: "Ladrillo Común de Campo seleccionado", category: "Ladrillos y Bloques", unit: "unidad", price: 190, stock: 4000, is_out_of_stock: 0, image_url: "/img/products/ladrillo-comun.webp", is_featured: 0, min_stock: 500 },
      { name: "Hierro Conformado ADN 420 Ø 8 mm x 12 m", category: "Hierros y Mallas", unit: "barra", price: 8900, stock: 300, is_out_of_stock: 0, image_url: "/img/products/hierro-8mm.webp", is_featured: 1, min_stock: 50 },
      { name: "Hierro Conformado ADN 420 Ø 10 mm x 12 m", category: "Hierros y Mallas", unit: "barra", price: 14200, stock: 220, is_out_of_stock: 0, image_url: "/img/products/hierro-10mm.webp", is_featured: 0, min_stock: 40 },
      { name: "Hierro Conformado ADN 420 Ø 12 mm x 12 m", category: "Hierros y Mallas", unit: "barra", price: 19800, stock: 180, is_out_of_stock: 0, image_url: "/img/products/hierro-12mm.webp", is_featured: 0, min_stock: 30 },
      { name: "Malla Sima 15x15 Ø 4.2 mm (paño 2x3 m)", category: "Hierros y Mallas", unit: "unidad", price: 24500, stock: 60, is_out_of_stock: 0, image_url: "/img/products/malla-sima-42mm.webp", is_featured: 0, min_stock: 15 },
      { name: "Malla Sima 15x15 6mm pesada", category: "Hierros y Mallas", unit: "unidad", price: 38000, stock: 50, is_out_of_stock: 0, image_url: "/img/products/malla-sima-6mm.webp", is_featured: 0, min_stock: 10 },
      { name: "Adhesivo Impermeable Klaukol Tradicional (30 kg)", category: "Adhesivos y Pastinas", unit: "bolsa", price: 12400, stock: 100, is_out_of_stock: 0, image_url: "/img/products/adhesivo-klaukol-30kg.webp", is_featured: 0, min_stock: 20 },
      { name: "Pastina Fluida Weber Gris Perla (5 kg)", category: "Adhesivos y Pastinas", unit: "bolsa", price: 6900, stock: 0, is_out_of_stock: 1, image_url: "/img/products/pastina-weber-5kg.webp", is_featured: 0, min_stock: 10 },
      { name: "Vigueta Pretensada 4.00 m Reforzada", category: "Techos", unit: "unidad", price: 23000, stock: 40, is_out_of_stock: 0, image_url: "/img/products/vigueta-pretensada-4m.webp", is_featured: 0, min_stock: 10 },
      { name: "Membrana Geotextil 4mm", category: "Impermeabilizaciones", unit: "rollo", price: 52000, stock: 20, is_out_of_stock: 0, image_url: "/img/products/membrana-geotextil-4mm.webp", is_featured: 0, min_stock: 5 },
      { name: "Pintura Látex Exterior/Interior (20 L)", category: "Pinturas", unit: "unidad", price: 48500, stock: 35, is_out_of_stock: 0, image_url: "/img/products/pintura-latex-20l.webp", is_featured: 1, min_stock: 8 }
    ];

    const insertMany = db.transaction((products) => {
      for (const prod of products) insert.run(prod);
    });

    insertMany(initialProducts);
    console.log('[DB] 20 productos iniciales con imágenes cargados.');
  }
}

// Obtener próximo número de pedido correlativo
function getNextOrderNumber() {
  const row = db.prepare('SELECT MAX(order_number) as max_num FROM orders').get();
  return (row && row.max_num) ? row.max_num + 1 : 1001;
}

initDatabase();

module.exports = {
  db,
  getNextOrderNumber
};
