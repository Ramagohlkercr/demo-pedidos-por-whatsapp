#  Pedidos por WhatsApp — Sistema de Catálogo y Gestión para Corralones y Distribuidoras

Aplicación web profesional pensada para demostraciones en videollamadas con dueños de corralones de materiales de construcción, ferreterías industriales y distribuidoras de Argentina.

Permite mostrar en vivo cómo un cliente o constructor arma su lista de materiales desde el celular, genera un pedido ordenado con número correlativo, abre automáticamente WhatsApp con el mensaje formateado y deja el pedido registrado en tiempo real en un panel administrativo para controlar su preparación, emitir remitos y notificar al cliente.

---

##  Funcionalidades Completas por Etapa

###  Etapa 1: Frontend Mobile-First & PWA
- **Sistema de Diseño con Variables CSS**: Color de marca primario y secundario configurables en 1 minuto, tipografía limpia (`Plus Jakarta Sans`), espaciados consistentes, bordes redondeados y sombras suaves.
- **Experiencia de Usuario Mobile-First**: 
  - En celular: Carrito flotante inferior con total y cantidad que despliega un **Bottom Sheet** deslizable.
  - En escritorio: Panel lateral deslizante (*slide-over*) para checkout y detalle de pedidos.
- **Estados de Carga y Feedback**: Skeletons animados durante la carga, avisos tipo toast al agregar/quitar ítems, y etiquetas claras de "Sin Stock".
- **Accesibilidad**: Áreas táctiles cómodas (mínimo 44px para el pulgar), alto contraste y foco visible.
- **Instalable como PWA**: Incluye `manifest.json` dinámico y `sw.js` (Service Worker) que permite agregar la app a la pantalla de inicio del celular como una app nativa con el logo y nombre del corralón.

###  Etapa 2: Funciones para el Cliente
- ** "Repetir mi último pedido"**: El cliente ingresa su número de teléfono y puede ver sus pedidos anteriores y cargarlos al carrito con 1 click. Si algún material subió de precio o se quedó sin stock, el sistema le avisa automáticamente.
- ** Reglas de Negocio Configurables**:
  - **Monto mínimo de pedido**: Alerta visual en el carrito si el subtotal no alcanza el mínimo configurado (`MIN_ORDER_AMOUNT`).
  - **Zonas y Costos de Flete**: Selector de zonas de envío configurables (`SHIPPING_ZONES`) con cálculo automático del flete o modalidad "A coordinar".
  - **Horario de atención dinámico**: Indicador "Abierto hasta las 18:00" o "Cerrado" según los días y rangos horarios (`BUSINESS_HOURS`).
- ** Observaciones de Entrega**: Campo para notas de obra (ej. *"descargar en vereda sobre pallets"*, *"llamar antes de salir"*).
- ** Productos Destacados y "Más Pedidos"**: Carrusel superior de acceso rápido para los materiales de mayor rotación (cemento, arena, barras de hierro).
- ** Mostrador QR (`/qr`)**: Página lista para imprimir en hoja A4 o exhibir en el mostrador del corralón con el código QR y enlace corto para que los clientes escaneen y pidan desde su celular.

###  Etapa 3: Funciones para el Negocio (Panel `/admin`)
- ** Aviso en Vivo de Pedidos Nuevos**: Notificación visual y campanilla sonora (*Web Audio API*) en tiempo real sin recargar la página (mediante Server-Sent Events / SSE con fallback a polling).
- ** Avisar al Cliente por WhatsApp con 1 Click**: Al cambiar el estado de un pedido a *Preparando*, *Listo* o *Entregado*, se abre un modal con un mensaje personalizado y editable listo para enviar por `wa.me`.
- ** Resumen del Día y Métricas**:
  - Tarjetas de KPIs: Total facturado, cantidad de pedidos y ticket promedio.
  - Distribución de pedidos por estado.
  - Tabla de los **Top 5 Materiales Más Pedidos** (con cantidades y montos).
  - Filtro por rango temporal: *Hoy*, *Últimos 7 días* y *Últimos 30 días*.
- ** Remito y Orden de Preparación Imprimible (`/admin/orders/:id/remito`)**: Hoja de preparación formato A4 profesional con datos del corralón, cliente, dirección de obra, observaciones, checkboxes para picking en depósito y sección de firma de recepción.
- ** Exportación a CSV**: Descarga instantánea de pedidos en formato compatible con Excel de Argentina (separador `;` y codificación UTF-8 con BOM para evitar caracteres extraños).
- ** Control de Stock y Descuento Automático**:
  - Alerta visual de stock bajo según el umbral mínimo (`min_stock`) por producto.
  - Descuento automático de inventario cuando la orden pasa a estado `Preparando`.
- ** Subida de Fotos de Productos**: Carga de imágenes desde el panel administrativo con almacenamiento local (`/uploads`).

---

##  Stack Tecnológico

- **Backend**: Node.js + Express
- **Base de datos**: SQLite con `better-sqlite3` (modo WAL de alto rendimiento, migraciones automáticas al iniciar)
- **Frontend**: HTML5 semántico, CSS moderno con variables personalizables, JavaScript Vanilla (sin frameworks pesados ni dependencias de compilación)
- **Subida de Archivos**: Multer para imágenes de catálogo
- **Comunicación en Vivo**: Server-Sent Events (SSE) y Web Audio API nativo

---

##  Configuración y Rebranding por Cliente

Para personalizar la demo para un nuevo corralón, solo tenés que editar las variables de entorno en el archivo `.env`:

```env
# Puerto del servidor
PORT=3001

# Datos del Corralón / Distribuidora
STORE_NAME="Corralón & Distribuidora Norte"
STORE_TAGLINE="Materiales de Construcción • Venta Mayorista y Minorista"
STORE_LOGO="" # URL de logo personalizada o vacío para ícono por defecto
PRIMARY_COLOR="#f97316" # Color principal (hex). Ej: Naranja #f97316, Azul #2563eb, Amarillo #eab308
SECONDARY_COLOR="#0f172a"

# WhatsApp receptor de los pedidos (formato internacional sin +)
# Argentina: 549 + código de área + número (ej. 5491123456789)
WHATSAPP_PHONE="5491123456789"

# Contraseña de acceso a /admin
ADMIN_PASSWORD="admin123"

# Reglas de negocio
MIN_ORDER_AMOUNT=15000
AUTO_DEDUCT_STOCK=true

# Zonas de envío (JSON)
SHIPPING_ZONES='[{"name":"Zona Centro (hasta 5 km)","price":4500},{"name":"Zona Obra Media (5 a 15 km)","price":8500},{"name":"Zona Periférica / Canteras","price":14000},{"name":"A coordinar con el corralón","price":0}]'

# Horarios de atención (Lunes a Viernes de 07:30 a 18:00, Sábados de 08:00 a 13:00)
BUSINESS_HOURS='{"mon":{"open":"07:30","close":"18:00"},"tue":{"open":"07:30","close":"18:00"},"wed":{"open":"07:30","close":"18:00"},"thu":{"open":"07:30","close":"18:00"},"fri":{"open":"07:30","close":"18:00"},"sat":{"open":"08:00","close":"13:00"},"sun":{"open":null,"close":null}}'

# Persistencia
DATABASE_PATH="./pedidos.db"
```

---

##  Cómo Correrlo Localmente

### Requisitos
- Node.js versión 18 o superior.

### Pasos
1. Clonar o descargar este directorio e ingresar:
   ```bash
   cd "Demo Pedidos por whatsapp"
   ```

2. Instalar dependencias:
   ```bash
   npm install
   ```

3. (Opcional) Copiar `.env.example` a `.env`:
   ```bash
   cp .env.example .env
   ```

4. Iniciar la aplicación:
   ```bash
   npm start
   ```

5. Abrir en el navegador:
   - **Catálogo de clientes**: [http://localhost:3001](http://localhost:3001)
   - **Panel de administración**: [http://localhost:3001/admin](http://localhost:3001/admin) *(Contraseña por defecto: `admin123`)*
   - **Página de QR para mostrador**: [http://localhost:3001/qr](http://localhost:3001/qr)

---

##  Cómo Desplegar en Render (con 1 comando)

Esta app está lista para ser desplegada en [Render](https://render.com) como un **Web Service**:

1. Subí este código a un repositorio de GitHub o GitLab.
2. En Render, creá un **New Web Service** y conectá tu repositorio.
3. Configurá:
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
4. En **Environment Variables**, agregá:
   - `STORE_NAME`: Nombre del corralón.
   - `WHATSAPP_PHONE`: El WhatsApp del negocio (formato `54911...`).
   - `ADMIN_PASSWORD`: Tu clave privada para el panel.
   - `PRIMARY_COLOR`: El color de marca del cliente (ej. `#f97316`).
   - `MIN_ORDER_AMOUNT`: `15000`
   - `NODE_ENV`: `production`
5. *(Recomendado para persistencia en Render)*:
   - En la sección **Disks**, agregá un Persistent Disk (ej: Mount Path: `/data`, Size: 1 GB).
   - Agregá la variable de entorno: `DATABASE_PATH=/data/pedidos.db`.
6. Hacé click en **Create Web Service**. ¡Listo! Render te dará una URL pública HTTPS lista para compartir.

> [!NOTE]
> **Rate Limiting detrás de Proxy en Render (`trust proxy`)**:
> En Render los servicios web corren detrás de un reverse proxy. Para que las restricciones antispam de `express-rate-limit` funcionen de forma correcta e independiente por cada cliente, se configuró `app.set('trust proxy', 1)` al inicio de `server.js`. Esto permite que Express resuelva la IP real del cliente a partir de la cabecera `X-Forwarded-For`, evitando advertencias `ERR_ERL_*` y asegurando que el límite de 5 pedidos cada 10 minutos y 10 intentos de login se aplique de manera individual por cliente y no de forma global compartida.

---

##  Resumen de Endpoints de la API

| Método | Endpoint | Descripción |
|---|---|---|
| `GET` | `/api/config` | Configuración pública (marca, colores, horarios, zonas, mínimo) |
| `GET` | `/api/products` | Catálogo de productos activos con buscador y filtro de categoría |
| `POST` | `/api/orders` | Crear pedido, generar número correlativo y emitir evento en vivo |
| `GET` | `/api/customer/orders?phone=...` | Historial de pedidos anteriores del cliente para repetir |
| `GET` | `/api/admin/events` | Stream de Server-Sent Events (SSE) para avisos en vivo |
| `GET` | `/api/admin/orders` | Listado de pedidos con filtros por estado y fecha |
| `PATCH` | `/api/admin/orders/:id/status` | Actualizar estado, descontar stock y generar mensaje de WhatsApp |
| `GET` | `/admin/orders/:id/remito` | Remito y orden de preparación para imprimir en A4 |
| `GET` | `/api/admin/orders/export-csv` | Descarga de pedidos en CSV para Excel de Argentina |
| `GET` | `/api/admin/metrics?range=...` | KPIs de facturación, cantidad de pedidos y Top 5 productos |
| `POST` | `/api/admin/upload-image` | Subida de fotos de productos con compresión y preview |
| `GET` | `/qr` | Cartel de mostrador con código QR listo para imprimir |
