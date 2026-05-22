const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// ============================================
// CONEXIÓN A NEON (PostgreSQL)
// La variable DATABASE_URL se configura en Render
// ============================================
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

pool.connect((err) => {
    if (err) {
        console.error('❌ Error al conectar a Neon:', err.message);
        return;
    }
    console.log('✨ ¡Conexión exitosa a Neon PostgreSQL!');
});

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
// ============================================
app.post('/api/clientes/registro', async (req, res) => {
    const { Nombre, Telefono, Direccion, Email, Password } = req.body;
    try {
        const result = await pool.query(
            'INSERT INTO clientes ("Nombre", "Telefono", "Direccion", "Email", "Password") VALUES ($1, $2, $3, $4, $5) RETURNING "Id_Cliente"',
            [Nombre, Telefono, Direccion || '', Email, Password]
        );
        res.json({
            success: true,
            Id_Cliente: result.rows[0].Id_Cliente,
            message: '✨ ¡Usuario registrado en Neon!'
        });
    } catch (err) {
        // Error de email duplicado
        if (err.code === '23505') {
            return res.json({ success: false, message: 'El correo ya está registrado' });
        }
        console.error('❌ Error al registrar cliente:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// RUTA PARA LOGIN DE CLIENTE
// ============================================
app.post('/api/clientes/login', async (req, res) => {
    const { Email, Password } = req.body;
    try {
        const result = await pool.query(
            'SELECT * FROM clientes WHERE "Email" = $1 AND "Password" = $2',
            [Email, Password]
        );
        if (result.rows.length > 0) {
            res.json({ success: true, usuario: result.rows[0] });
        } else {
            res.json({ success: false, message: 'Usuario o contraseña incorrectos' });
        }
    } catch (err) {
        console.error('❌ Error en login:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// RUTA PARA REGISTRAR UN NUEVO PEDIDO
// ============================================
app.post('/api/pedidos/nuevo', async (req, res) => {
    const { Id_Cliente, Id_Restaurante, Total_Pedido, Productos_Carrito } = req.body;

    const clienteId    = Id_Cliente     || 1;
    const restauranteId = Id_Restaurante || 1;
    const total        = Total_Pedido   || 0.00;

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Insertar pedido y obtener el ID generado
        const resPedido = await client.query(
            'INSERT INTO pedidos ("Id_Cliente", "Id_Restaurante", "Total_Pedido") VALUES ($1, $2, $3) RETURNING "Id_Pedido"',
            [clienteId, restauranteId, total]
        );
        const nuevoIdPedido = resPedido.rows[0].Id_Pedido;

        // Si no hay productos, confirmar y salir
        if (!Productos_Carrito || !Array.isArray(Productos_Carrito) || Productos_Carrito.length === 0) {
            await client.query('COMMIT');
            return res.json({ success: true, message: '🛍️ ¡Pedido registrado!' });
        }

        // Insertar cada producto del carrito
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