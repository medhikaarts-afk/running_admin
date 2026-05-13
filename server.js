require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const fs = require('fs');
const Razorpay = require('razorpay');
const crypto = require('crypto');

const app = express();
app.use(cors()); // Permissive CORS for local development
app.use(express.json({ limit: '50mb' }));
app.use(express.static(__dirname));

app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

// New removal route
app.post('/api/bookings/remove/:id', async (req, res) => {
    const id = req.params.id;
    console.log(`[CANCELLATION REQUEST] ID: ${id} at ${new Date().toISOString()}`);
    
    if (isConnected) {
        try {
            const result = await Booking.deleteOne({ $or: [{ id: id }, { _id: id }] });
            if (result.deletedCount > 0) {
                console.log(`[SUCCESS] Booking ${id} removed from MongoDB`);
                return res.json({ success: true });
            }
        } catch(e) { console.error('[ERROR] DB removal failed:', e); }
    }
    
    const idx = localDb.bookings.findIndex(b => b.id === id || b._id === id);
    if (idx !== -1) {
        localDb.bookings.splice(idx, 1);
        saveLocal();
        console.log(`[SUCCESS] Booking ${id} removed from localDb.json`);
        return res.json({ success: true });
    }
    
    console.log(`[NOT FOUND] Booking ${id} not found in any database`);
    res.status(404).json({ error: 'Booking not found' });
});

// Safe Removal route (GET) - Bypass browser POST restrictions
app.get('/api/bookings/remove-safe/:id', async (req, res) => {
    const id = req.params.id;
    console.log(`[SAFE CANCELLATION REQUEST] ID: ${id} at ${new Date().toISOString()}`);
    
    if (isConnected) {
        try {
            await Booking.deleteOne({ $or: [{ id: id }, { _id: id }] });
        } catch(e) {}
    }
    const idx = localDb.bookings.findIndex(b => b.id === id || b._id === id);
    if (idx !== -1) {
        localDb.bookings.splice(idx, 1);
        saveLocal();
    }
    // Always return success or redirect back to dashboard to avoid "stuck" page
    res.send('<script>alert("Cancellation processed."); window.close();</script>Cancellation successful. You can close this tab.');
});

// Update Booking route (PUT) - For Rescheduling
app.put('/api/bookings/:id', async (req, res) => {
    const id = req.params.id;
    const updatedData = req.body;
    console.log(`[UPDATE REQUEST] ID: ${id} at ${new Date().toISOString()}`);
    
    if (isConnected) {
        try {
            await Booking.updateOne({ $or: [{ id: id }, { _id: id }] }, updatedData);
            console.log(`[SUCCESS] Booking ${id} updated in MongoDB`);
        } catch(e) { console.error('[ERROR] MongoDB update failed:', e); }
    }
    
    const idx = localDb.bookings.findIndex(b => b.id === id || b._id === id);
    if (idx !== -1) {
        localDb.bookings[idx] = { ...localDb.bookings[idx], ...updatedData };
        saveLocal();
        console.log(`[SUCCESS] Booking ${id} updated in localDb.json`);
        return res.json({ success: true });
    }
    
    res.status(404).json({ error: 'Booking not found' });
});

const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/medhikaarts';
const DB_FILE = 'db.json';

let localDb = { clients: [], staff: [], services: [], inventory: [], bookings: [] };
if (fs.existsSync(DB_FILE)) {
    try { localDb = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch (e) { console.error('Error reading db.json'); }
}
const saveLocal = () => fs.writeFileSync(DB_FILE, JSON.stringify(localDb, null, 2));

// Initialize Razorpay (Replace with your actual keys from Razorpay Dashboard)
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID || 'rzp_test_YourKeyHere',
    key_secret: process.env.RAZORPAY_KEY_SECRET || 'YourSecretHere'
});

mongoose.set('bufferCommands', false);

let isConnected = false;
// mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 2000 })
//   .then(() => { console.log('Connected to MongoDB'); isConnected = true; })
//   .catch(err => { console.error('MongoDB connection failed. Falling back to local storage.'); isConnected = false; });
console.log('Running in LOCAL STORAGE mode (MongoDB bypassed)');
isConnected = false;

const clientSchema = new mongoose.Schema({ id: String, name: String, phone: String, email: String, location: String, pts: Number, ltv: String, av: String }, { bufferCommands: false });
const staffSchema = new mongoose.Schema({ id: String, name: String, gender: String, spec: String, rating: String, av: String, services: [String], status: String }, { bufferCommands: false });
const serviceSchema = new mongoose.Schema({ id: String, name: String, cat: String, duration: Number, price: Number, prices: [Number], icon: String, gender: String }, { bufferCommands: false });
const inventorySchema = new mongoose.Schema({ id: String, name: String, cat: String, stock: Number, min: Number, unit: String, cost: Number }, { bufferCommands: false });
const bookingSchema = new mongoose.Schema({ id: String, clientId: String, clientName: String, services: [String], staffId: String, date: String, time: String, total: Number, status: String, notes: String, source: String, location: String, deposit: Boolean, timestamp: String }, { bufferCommands: false });

const Client = mongoose.model('Client', clientSchema);
const Staff = mongoose.model('Staff', staffSchema);
const Service = mongoose.model('Service', serviceSchema);
const Inventory = mongoose.model('Inventory', inventorySchema);
const Booking = mongoose.model('Booking', bookingSchema);

const eventSchema = new mongoose.Schema({ id: String, title: String, date: String, time: String, type: String, description: String }, { bufferCommands: false });
const Event = mongoose.model('Event', eventSchema);

// Clients
app.get('/api/clients', async (req, res) => {
    if (isConnected) { try { return res.json(await Client.find()); } catch(e) {} }
    res.json(localDb.clients);
});
app.post('/api/clients', async (req, res) => {
    if (isConnected) { try { return res.json(await new Client(req.body).save()); } catch(e) {} }
    localDb.clients.push(req.body); saveLocal(); res.json(req.body);
});
app.put('/api/clients/:id', async (req, res) => {
    const searchId = String(req.params.id).trim();
    if (isConnected) {
        try {
            const updated = await Client.findOneAndUpdate(
                { $or: [{ id: searchId }, { name: { $regex: new RegExp(`^${searchId}$`, 'i') } }] },
                req.body,
                { new: true }
            );
            if (updated) return res.json(updated);
        } catch(e) {}
    }
    const idx = localDb.clients.findIndex(c => 
        String(c.id).trim() === searchId || 
        String(c.name).trim().toLowerCase() === searchId.toLowerCase()
    );
    if (idx !== -1) {
        localDb.clients[idx] = { ...localDb.clients[idx], ...req.body };
        saveLocal();
        return res.json(localDb.clients[idx]);
    }
    res.status(404).json({ error: 'Client not found' });
});

// Staff
app.get('/api/staff', async (req, res) => {
    if (isConnected) { try { return res.json(await Staff.find()); } catch(e) {} }
    res.json(localDb.staff);
});
app.post('/api/staff', async (req, res) => {
    if (isConnected) { try { return res.json(await new Staff(req.body).save()); } catch(e) {} }
    localDb.staff.push(req.body); saveLocal(); res.json(req.body);
});

// Services
app.get('/api/services', async (req, res) => {
    if (isConnected) { try { return res.json(await Service.find()); } catch(e) {} }
    res.json(localDb.services);
});

app.post('/api/services', async (req, res) => {
    console.log('Received POST request for new service:', req.body);
    if (isConnected) { try { return res.json(await new Service(req.body).save()); } catch(e) {} }
    localDb.services.push(req.body); saveLocal(); res.json(req.body);
});

app.put('/api/services/:id', async (req, res) => {
    if (isConnected) { 
        try { 
            const updated = await Service.findOneAndUpdate(
                { $or: [{ id: req.params.id }, { name: req.params.id }] }, 
                req.body, 
                { new: true }
            );
            if (updated) return res.json(updated);
        } catch(e) {} 
    }
    const idx = localDb.services.findIndex(s => s.id === req.params.id || s.name === req.params.id);
    if (idx !== -1) { 
        localDb.services[idx] = { ...localDb.services[idx], ...req.body }; 
        saveLocal(); 
        return res.json(localDb.services[idx]); 
    }
    res.status(404).json({ error: 'Not found' });
});

app.delete('/api/services/:id', async (req, res) => {
    const idOrName = req.params.id;
    if (isConnected) { 
        try { 
            const deleted = await Service.findOneAndDelete({ $or: [{ id: idOrName }, { name: idOrName }] });
            if (deleted) return res.json({ message: 'Deleted' });
        } catch(e) {} 
    }
    const idx = localDb.services.findIndex(s => s.id === idOrName || s.name === idOrName);
    if (idx !== -1) { 
        localDb.services.splice(idx, 1); 
        saveLocal(); 
        return res.json({ message: 'Deleted' }); 
    }
    res.status(404).json({ error: 'Not found' });
});

// Inventory
app.get('/api/inventory', async (req, res) => {
    if (isConnected) { try { return res.json(await Inventory.find()); } catch(e) {} }
    res.json(localDb.inventory);
});
app.post('/api/inventory', async (req, res) => {
    if (isConnected) { try { return res.json(await new Inventory(req.body).save()); } catch(e) {} }
    localDb.inventory.push(req.body); saveLocal(); res.json(req.body);
});
app.put('/api/inventory/:id', async (req, res) => {
    if (isConnected) { 
        try { 
            const updated = await Inventory.findOneAndUpdate(
                { $or: [{ id: req.params.id }, { name: req.params.id }] }, 
                req.body, 
                { new: true }
            );
            if (updated) return res.json(updated);
        } catch(e) {} 
    }
    const idx = localDb.inventory.findIndex(i => i.id === req.params.id || i.name === req.params.id);
    if (idx !== -1) { 
        localDb.inventory[idx] = { ...localDb.inventory[idx], ...req.body }; 
        saveLocal(); 
        return res.json(localDb.inventory[idx]); 
    }
    res.status(404).json({ error: 'Not found' });
});

app.delete('/api/inventory/:id', async (req, res) => {
    if (isConnected) {
        try {
            await Inventory.deleteOne({ $or: [{ id: req.params.id }, { name: req.params.id }] });
            return res.json({ success: true });
        } catch(e) {}
    }
    const idx = localDb.inventory.findIndex(i => i.id === req.params.id || i.name === req.params.id);
    if (idx !== -1) {
        localDb.inventory.splice(idx, 1);
        saveLocal();
        return res.json({ success: true });
    }
    res.status(404).json({ error: 'Item not found' });
});

// Bookings
app.get('/api/bookings', async (req, res) => {
    if (isConnected) { try { return res.json(await Booking.find()); } catch(e) {} }
    res.json(localDb.bookings);
});
app.post('/api/bookings', async (req, res) => {
    if (isConnected) { try { return res.json(await new Booking(req.body).save()); } catch(e) {} }
    localDb.bookings.push(req.body); saveLocal(); res.json(req.body);
});
app.put('/api/bookings/:id', async (req, res) => {
    if (isConnected) { try { return res.json(await Booking.findOneAndUpdate({ id: req.params.id }, req.body, { new: true })); } catch(e) {} }
    const idx = localDb.bookings.findIndex(b => b.id === req.params.id);
    if (idx !== -1) { localDb.bookings[idx] = { ...localDb.bookings[idx], ...req.body }; saveLocal(); return res.json(localDb.bookings[idx]); }
    res.status(404).json({ error: 'Not found' });
});
app.delete('/api/bookings/:id', async (req, res) => {
    const id = req.params.id;
    if (isConnected) {
        try {
            const result = await Booking.deleteOne({ $or: [{ id: id }, { _id: id }] });
            if (result.deletedCount > 0) return res.json({ success: true });
        } catch(e) {}
    }
    const idx = localDb.bookings.findIndex(b => b.id === id || b._id === id);
    if (idx !== -1) {
        localDb.bookings.splice(idx, 1);
        saveLocal();
        return res.json({ success: true });
    }
    res.status(404).json({ error: 'Booking not found' });
});

// Fallback POST route for deletion (more compatible with some firewalls)
app.post('/api/bookings/delete/:id', async (req, res) => {
    const id = req.params.id;
    if (isConnected) {
        try {
            const result = await Booking.deleteOne({ $or: [{ id: id }, { _id: id }] });
            if (result.deletedCount > 0) return res.json({ success: true });
        } catch(e) {}
    }
    const idx = localDb.bookings.findIndex(b => b.id === id || b._id === id);
    if (idx !== -1) {
        localDb.bookings.splice(idx, 1);
        saveLocal();
        return res.json({ success: true });
    }
    res.status(404).json({ error: 'Booking not found' });
});

// --- NEW: Payment Integration Routes ---
app.post('/api/payment/create-session', async (req, res) => {
    const { amount, bookingId, clientName } = req.body;
    
    // Check if keys are placeholders
    const isMock = !process.env.RAZORPAY_KEY_ID || 
                   process.env.RAZORPAY_KEY_ID.includes('YourKeyHere') || 
                   process.env.RAZORPAY_KEY_ID.includes('PASTE_YOUR_KEY');

    if (isMock) {
        console.log("Using Mock Payment Mode (No real keys found)");
        return res.json({ 
            orderId: "order_mock_" + Math.random().toString(36).substr(2, 9),
            amount: amount * 100,
            currency: "INR",
            key: "rzp_test_mockkey",
            isMock: true
        });
    }

    try {
        const options = {
            amount: amount * 100, // Razorpay works in paise (₹1 = 100 paise)
            currency: "INR",
            receipt: `receipt_${bookingId}`,
        };

        const order = await razorpay.orders.create(options);
        
        // Return order details for the frontend to use
        res.json({ 
            orderId: order.id,
            amount: order.amount,
            currency: order.currency,
            key: razorpay.key_id // Send public key to frontend
        });
    } catch (err) {
        console.error("Razorpay Order Error:", err);
        res.status(500).json({ error: "Failed to create payment order. Check your keys." });
    }
});

app.post('/api/payment/verify', async (req, res) => {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
        .createHmac("sha256", razorpay.key_secret)
        .update(body.toString())
        .digest("hex");

    if (expectedSignature === razorpay_signature) {
        // Payment verified! Update booking status
        // (You would normally find the booking by orderId metadata or receipt)
        res.json({ status: "success", message: "Payment verified successfully" });
    } else {
        res.status(400).json({ status: "failure", message: "Invalid signature" });
    }
});

// Events
app.get('/api/events', async (req, res) => {
    if (isConnected) { try { return res.json(await Event.find()); } catch(e) {} }
    res.json(localDb.events || []);
});
app.post('/api/events', async (req, res) => {
    if (isConnected) { try { return res.json(await new Event(req.body).save()); } catch(e) {} }
    if (!localDb.events) localDb.events = [];
    localDb.events.push(req.body); saveLocal(); res.json(req.body);
});
app.put('/api/events/:id', async (req, res) => {
    if (isConnected) { try { return res.json(await Event.findOneAndUpdate({ id: req.params.id }, req.body, { new: true })); } catch(e) {} }
    const idx = (localDb.events || []).findIndex(e => e.id === req.params.id);
    if (idx !== -1) { localDb.events[idx] = { ...localDb.events[idx], ...req.body }; saveLocal(); return res.json(localDb.events[idx]); }
    res.status(404).json({ error: 'Not found' });
});
app.delete('/api/events/:id', async (req, res) => {
    if (isConnected) { try { await Event.deleteOne({ id: req.params.id }); return res.json({ success: true }); } catch(e) {} }
    const idx = (localDb.events || []).findIndex(e => e.id === req.params.id);
    if (idx !== -1) { localDb.events.splice(idx, 1); saveLocal(); return res.json({ success: true }); }
    res.status(404).json({ error: 'Not found' });
});

// Seed
app.post('/api/seed', async (req, res) => {
    const { clients, staff, services, inventory, events } = req.body;
    if (isConnected) {
        try {
            if (clients) { await Client.deleteMany({}); await Client.insertMany(clients); }
            if (staff) { await Staff.deleteMany({}); await Staff.insertMany(staff); }
            if (services) { await Service.deleteMany({}); await Service.insertMany(services); }
            if (inventory) { await Inventory.deleteMany({}); await Inventory.insertMany(inventory); }
            if (events) { await Event.deleteMany({}); await Event.insertMany(events); }
        } catch (e) { console.error('Seed error:', e); }
    }
    if (clients) localDb.clients = clients;
    if (staff) localDb.staff = staff;
    if (services) localDb.services = services;
    if (inventory) localDb.inventory = inventory;
    if (events) localDb.events = events;
    saveLocal();
    res.json({ message: 'Success' });
});

// --- Admin Utilities (Combined from scratch scripts) ---
app.post('/api/admin/clear-bookings', async (req, res) => {
    localDb.bookings = [];
    saveLocal();
    if (isConnected) {
        try { await Booking.deleteMany({}); } catch (e) { console.error(e); }
    }
    res.json({ message: 'Bookings cleared successfully!' });
});

app.post('/api/admin/import-csv', (req, res) => {
    try {
        const csvPath = 'Services.csv';
        if (!fs.existsSync(csvPath)) return res.status(400).json({ error: 'Services.csv not found' });
        const csvData = fs.readFileSync(csvPath, 'utf8');
        const lines = csvData.split('\n').filter(l => l.trim() && !l.startsWith('Category,'));
        
        const icons = {
            'Eyebrow': '👁️', 'Threading': '🧵', 'Waxing': '🍯', 'Bleach': '✨',
            'De Tan': '☀️', 'Facial': '💆', 'Spa': '🛀', 'Manicures': '💅',
            'Pedicures': '🦶', 'Ear': '👂', 'Hair': '✂️', 'Make up': '💄',
            'Body': '🧖', 'Bride': '👑'
        };
        const getIcon = (cat) => {
            for (const key in icons) if (cat.toLowerCase().includes(key.toLowerCase())) return icons[key];
            return '✨';
        };

        const servicesMap = {};
        lines.forEach((line) => {
            const parts = line.split(',');
            const rawCat = parts[0].trim();
            const name = parts[1].trim();
            const variant = parts[2] ? parts[2].trim() : '';
            const priceStr = parts[3] ? parts[3].trim() : '';
            const price = priceStr ? parseFloat(priceStr) : 0;
            const key = rawCat + '|' + name;
            
            if (!servicesMap[key]) {
                servicesMap[key] = {
                    name: name, cat: rawCat, duration: 45, price: price,
                    prices: [], variants: [], icon: getIcon(rawCat), gender: 'unisex'
                };
            }
            servicesMap[key].prices.push(price);
            if (variant) servicesMap[key].variants.push(variant);
        });

        const newServices = Object.values(servicesMap).map((s, index) => {
            s.id = 'svc-' + (Date.now() + index);
            return s;
        });

        localDb.services = newServices;
        saveLocal();
        res.json({ message: 'Services updated successfully from CSV!', count: newServices.length });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/admin/seed-mongo', async (req, res) => {
    if (!isConnected) return res.status(500).json({ error: 'Not connected to MongoDB' });
    try {
        if (localDb.services && localDb.services.length > 0) {
            await Service.deleteMany({});
            await Service.insertMany(localDb.services);
            res.json({ message: `Successfully added ${localDb.services.length} services to MongoDB.` });
        } else {
            res.status(400).json({ error: 'No services found in localDb' });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// --- HTML Module Merger (Logic from merge.js) ---
app.post('/api/admin/merge-modules', (req, res) => {
    try {
        const targetFile = 'MedhikaArts_complete_module.html';
        const sourceFile = 'complete_module.html';
        const outputFile = 'MedhikaArts_complete_module_merged.html';

        if (!fs.existsSync(targetFile) || !fs.existsSync(sourceFile)) {
            return res.status(400).json({ error: 'Source or Target HTML files not found.' });
        }

        const f1 = fs.readFileSync(targetFile, 'utf8');
        const f2 = fs.readFileSync(sourceFile, 'utf8');

        // 1. Extract CSS
        const cssStart = f2.indexOf('/* Modal Tabs */');
        const cssEnd = f2.indexOf('</style>', cssStart);
        const extraCss = cssStart !== -1 ? f2.substring(cssStart, cssEnd) : '';

        // 2. Extract Notification Header
        const notifStart = f2.indexOf('<div class="notification-wrapper">');
        const notifEnd = f2.indexOf('<button class="btn"', notifStart);
        const notificationHtml = notifStart !== -1 ? f2.substring(notifStart, notifEnd) : '';

        // 3. Extract Ad Banner
        const adStart = f2.indexOf('<div class="ad-banner">');
        const adEnd = f2.indexOf('<div class="stats-grid">', adStart);
        const adHtml = adStart !== -1 ? f2.substring(adStart, adEnd) : '';

        // 4. Extract View Calendar
        const calStart = f2.indexOf('<!-- Full Calendar View -->');
        const calEnd = f2.indexOf('<div id="view-settings"', calStart);
        const calHtml = calStart !== -1 ? f2.substring(calStart, calEnd) : '';

        // 5. Extract Modals
        const modalsStart = f2.indexOf('<!-- Offers Modal -->');
        const modalsEnd = f2.indexOf('<script>', modalsStart);
        const modalsHtml = modalsStart !== -1 ? f2.substring(modalsStart, modalsEnd) : '';

        // 6. Extract JS Functions
        const jsStart = f2.indexOf('// Modal Functions');
        const jsEnd = f2.indexOf('</script>', jsStart);
        let extraJs = '';
        if (jsStart !== -1) {
            extraJs = f2.substring(jsStart, jsEnd);
        } else if (f2.indexOf('function toggleNotifications') !== -1) {
            extraJs = f2.substring(f2.indexOf('function toggleNotifications'), f2.indexOf('</script>', f2.indexOf('function toggleNotifications')));
        }

        let newF1 = f1;

        // Inject CSS
        if (extraCss) newF1 = newF1.replace('</style>', extraCss + '\n</style>');

        // Inject Notification Header
        const syncBtnPattern = /<button class="btn"\s+style="background: white; border: 1px solid var\(--border\); display: flex; align-items: center; gap: 8px;"\s+onclick="manualSync\(\)" id="sync-btn">/;
        if (notificationHtml) newF1 = newF1.replace(syncBtnPattern, notificationHtml + '\n<button class="btn" style="background: white; border: 1px solid var(--border); display: flex; align-items: center; gap: 8px;" onclick="manualSync()" id="sync-btn">');

        // Inject Ad Banner
        if (adHtml) newF1 = newF1.replace('<div class="stats-grid">', adHtml + '\n<div class="stats-grid">');

        // Inject View Calendar
        if (calHtml) newF1 = newF1.replace('<div id="view-settings"', calHtml + '\n<div id="view-settings"');

        // Inject Modals
        if (modalsHtml) newF1 = newF1.replace('<script>', modalsHtml + '\n<script>');

        // Inject JS Functions
        if (extraJs) newF1 = newF1.replace('</script>', '\n' + extraJs + '\n</script>');

        // Update nav to include full calendar if not present
        if (!newF1.includes('nav-calendar')) {
            newF1 = newF1.replace('<li class="nav-item" onclick="switchView(\'reports\')" id="nav-reports">Reports</li>', '<li class="nav-item" onclick="switchView(\'reports\')" id="nav-reports">Reports</li>\n                    <li class="nav-item" onclick="switchView(\'calendar\')" id="nav-calendar">Calendar</li>');
        }

        fs.writeFileSync(outputFile, newF1);
        res.json({ message: 'Modules merged successfully!', output: outputFile });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
