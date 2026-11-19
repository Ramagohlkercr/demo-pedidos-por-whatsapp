const { db } = require('../database');

const updates = [
  { match: '%Cemento Portland Loma Negra%', image: '/img/products/cemento-portland-50kg.webp' },
  { match: '%Cal Hidratada Cacique%', image: '/img/products/cal-hidratada-25kg.webp' },
  { match: '%Cemento de Albañilería Plasticor%', image: '/img/products/cemento-albanileria-40kg.webp' },
  { match: '%Arena Gruesa de Río%', image: '/img/products/arena-gruesa.webp' },
  { match: '%Arena Fina para Revoque%', image: '/img/products/arena-fina.webp' },
  { match: '%Piedra Partida Granítica%', image: '/img/products/piedra-partida.webp' },
  { match: '%Cascote Picado Limpio%', image: '/img/products/cascote-picado.webp' },
  { match: '%Ladrillo Hueco 12x18x33%', image: '/img/products/ladrillo-hueco-12x18x33.webp' },
  { match: '%Ladrillo Hueco 18x18x33%', image: '/img/products/ladrillo-hueco-18x18x33.webp' },
  { match: '%Ladrillo Común de Campo%', image: '/img/products/ladrillo-comun.webp' },
  { match: '%Hierro Conformado ADN 420 Ø 8 mm%', image: '/img/products/hierro-8mm.webp' },
  { match: '%Hierro Conformado ADN 420 Ø 10 mm%', image: '/img/products/hierro-10mm.webp' },
  { match: '%Hierro Conformado ADN 420 Ø 12 mm%', image: '/img/products/hierro-12mm.webp' },
  { match: '%Malla Sima 15x15 Ø 4.2 mm%', image: '/img/products/malla-sima-42mm.webp' },
  { match: '%Malla Sima 15x15 6mm%', image: '/img/products/malla-sima-6mm.webp' },
  { match: '%Adhesivo Impermeable Klaukol%', image: '/img/products/adhesivo-klaukol-30kg.webp' },
  { match: '%Pastina Fluida Weber%', image: '/img/products/pastina-weber-5kg.webp' },
  { match: '%Vigueta Pretensada%', image: '/img/products/vigueta-pretensada-4m.webp' },
  { match: '%Membrana Geotextil%', image: '/img/products/membrana-geotextil-4mm.webp' },
  { match: '%Pintura Látex%', image: '/img/products/pintura-latex-20l.webp' }
];

const updateStmt = db.prepare('UPDATE products SET image_url = ? WHERE name LIKE ?');

for (const u of updates) {
  const res = updateStmt.run(u.image, u.match);
  console.log(`[SEED] ${u.match} -> ${res.changes} updated to ${u.image}`);
}

// Check or insert Pintura Látex
const exists = db.prepare('SELECT id FROM products WHERE name LIKE ?').get('%Pintura Látex%');
if (!exists) {
  db.prepare(`
    INSERT INTO products (name, category, unit, price, stock, is_active, is_out_of_stock, image_url, is_featured, min_stock)
    VALUES (?, ?, ?, ?, ?, 1, 0, ?, 1, 15)
  `).run(
    'Pintura Látex Exterior/Interior (20 L)',
    'Pinturas',
    'unidad',
    48500,
    35,
    '/img/products/pintura-latex-20l.webp'
  );
  console.log('[SEED] Inserted Pintura Látex Exterior/Interior (20 L)');
}

// Clean duplicate products from test CSVs
db.prepare('DELETE FROM products WHERE id IN (20, 21, 22, 23, 24, 25)').run();

const prods = db.prepare('SELECT id, name, category, unit, price, stock, image_url FROM products WHERE is_active = 1').all();
console.log('\n--- PRODUCTOS ACTIVOS CON IMAGEN ---');
for (const p of prods) {
  console.log(`ID ${p.id}: ${p.name} -> ${p.image_url}`);
}
