const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// ============================================
// CONEXIÓN A NEON (PostgreSQL)
// ✅ FIX: Se elimina pool.connect() permanente
//         Se agrega manejo de errores para cuando
//         Neon corta conexiones inactivas (plan free)
// ============================================
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
});

// Captura errores de conexión sin crashear el servidor
pool.on('error', (err) => {
    console.error('⚠️ Conexión perdida con Neon (reconectando automáticamente):', err.message);
});

console.log('✨ Pool de Neon PostgreSQL listo');

// ============================================
// RUTA PARA OBTENER RESTAURANTES
// ============================================
app.get('/api/restaurantes', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM restaurantes ORDER BY "Id_Restaurante"');
        res.json(result.rows);
    } catch (err) {
        console.error('❌ Error al obtener restaurantes:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// RUTA PARA OBTENER PRODUCTOS DE UN RESTAURANTE
// ============================================
app.get('/api/productos/:idRestaurante', async (req, res) => {
    try {
        const { idRestaurante } = req.params;
        const result = await pool.query(
            'SELECT * FROM productos WHERE "Id_Restaurante" = $1',
            [idRestaurante]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('❌ Error al obtener productos:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// RUTA PARA REGISTRAR UN NUEVO CLIENTE
// ✅ FIX: Verifica email antes de insertar
//         Valida campos vacíos
//         Separa bien los errores
// ============================================
app.post('/api/clientes/registro', async (req, res) => {
    const { Nombre, Telefono, Direccion, Email, Password } = req.body;

    if (!Nombre || !Email || !Password) {
        return res.status(400).json({ success: false, message: 'Faltan datos requeridos (Nombre, Email o Password)' });
    }

    try {
        const existe = await pool.query(
            'SELECT "Id_Cliente" FROM clientes WHERE LOWER("Email") = LOWER($1)',
            [Email]
        );

        if (existe.rows.length > 0) {
            return res.json({ success: false, message: 'El correo ya está registrado' });
        }

        const result = await pool.query(
            'INSERT INTO clientes ("Nombre", "Telefono", "Direccion", "Email", "Password") VALUES ($1, $2, $3, $4, $5) RETURNING "Id_Cliente"',
            [Nombre, Telefono || '', Direccion || '', Email, Password]
        );

        res.json({
            success: true,
            Id_Cliente: result.rows[0]["Id_Cliente"],
            message: '✨ ¡Usuario registrado en Neon!'
        });

    } catch (err) {
        console.error('❌ Error al registrar cliente:', err.message);
        if (err.code === '23505') {
            return res.json({ success: false, message: 'El correo ya está registrado' });
        }
        res.status(500).json({ success: false, message: 'Error del servidor: ' + err.message });
    }
});

// ============================================
// RUTA PARA LOGIN DE CLIENTE
// ✅ FIX: LOWER() para ignorar mayúsculas en email
// ============================================
app.post('/api/clientes/login', async (req, res) => {
    const { Email, Password } = req.body;

    if (!Email || !Password) {
        return res.status(400).json({ success: false, message: 'Email y Password son requeridos' });
    }

    try {
        const result = await pool.query(
            'SELECT * FROM clientes WHERE LOWER("Email") = LOWER($1) AND "Password" = $2',
            [Email, Password]
        );

        if (result.rows.length > 0) {
            res.json({ success: true, usuario: result.rows[0] });
        } else {
            res.json({ success: false, message: 'Usuario o contraseña incorrectos' });
        }
    } catch (err) {
        console.error('❌ Error en login:', err.message);
        res.status(500).json({ success: false, message: 'Error del servidor: ' + err.message });
    }
});

// ============================================
// RUTA PARA REGISTRAR UN NUEVO PEDIDO
// ============================================
app.post('/api/pedidos/nuevo', async (req, res) => {
    const { Id_Cliente, Id_Restaurante, Total_Pedido, Productos_Carrito } = req.body;

    const clienteId     = Id_Cliente      || 1;
    const restauranteId = Id_Restaurante  || 1;
    const total         = Total_Pedido    || 0.00;

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const resPedido = await client.query(
            'INSERT INTO pedidos ("Id_Cliente", "Id_Restaurante", "Total_Pedido") VALUES ($1, $2, $3) RETURNING "Id_Pedido"',
            [clienteId, restauranteId, total]
        );
        const nuevoIdPedido = resPedido.rows[0]["Id_Pedido"];

        if (!Productos_Carrito || !Array.isArray(Productos_Carrito) || Productos_Carrito.length === 0) {
            await client.query('COMMIT');
            return res.json({ success: true, message: '🛍️ ¡Pedido registrado!' });
        }

        for (let i = 0; i < Productos_Carrito.length; i++) {
            const prod = Productos_Carrito[i];
            const idProducto = prod.Id_Producto || prod.id_producto || (i + 1);
            const cantidad   = prod.Cantidad    || prod.cantidad    || 1;
            const precio     = prod.Precio      || prod.precio      || 0.00;

            await client.query(
                'INSERT INTO detalle_pedidos ("Id_Pedido", "Id_Producto", "Cantidad", "Precio_Unitario_Hist") VALUES ($1, $2, $3, $4)',
                [nuevoIdPedido, idProducto, cantidad, precio]
            );
        }

        await client.query('COMMIT');
        res.json({ success: true, message: '🛍️ ¡Pedido y desglose registrados con éxito!' });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Error al guardar pedido:', err.message);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// ============================================
// INICIAR SERVIDOR
// ============================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor YaVoy corriendo en puerto ${PORT}`);
});
