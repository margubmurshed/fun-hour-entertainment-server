const express = require("express");
const https = require('https');
const fs = require('fs');
const cors = require("cors");
const os = require('os');
const { createCanvas } = require('canvas');
const escpos = require("escpos");
escpos.Network = require('escpos-network');
const path = require('path');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB URI
const uri = `mongodb+srv://${process.env.DB_USERNAME}:${process.env.DB_PASSWORD}@cluster0.hrq6pyr.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// MongoDB Client
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

// MongoDB connection and routes
async function run() {
  try {
    await client.connect();
    const fheDB = client.db("fheDB");
    const receiptsCollection = fheDB.collection("receipts");
    const cashesCollection = fheDB.collection("cashes");
    const productsCollection = fheDB.collection("products");

    // Receipts
    app.get("/receipts", async (req, res) => {
      const result = await receiptsCollection.find().toArray();
      res.send(result);
    });

    // Cashes
    app.get("/cashes", async (req, res) => {
      const result = await cashesCollection.find().toArray();
      res.send(result);
    });

    app.get("/cashes/:email", async (req, res) => {
      const email = req.params.email;
      const result = await cashesCollection.findOne({
        cashierEmail: email,
        closingCashAmount: null,
      });
      res.send(result);
    });

    // Products
    app.get("/products", async (req, res) => {
      const result = await productsCollection.find().toArray();
      res.send(result);
    });

    app.post("/products", async (req, res) => {
      const product = req.body;
      const result = await productsCollection.insertOne(product);
      res.send(result);
    });

    app.put("/products/:id", async (req, res) => {
      const id = req.params.id;
      const body = req.body;
      const result = await productsCollection.updateOne({ _id: new ObjectId(id) }, { $set: body });
      res.send(result);
    });

    app.delete("/products/:id", async (req, res) => {
      const id = req.params.id;
      const result = await productsCollection.deleteOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    // Post cash
    app.post("/cashes", async (req, res) => {
      const data = req.body;
      const result = await cashesCollection.insertOne(data);
      res.send(result);
    });

    app.patch("/cashes/:id", async (req, res) => {
      const id = req.params.id;
      const body = req.body;
      const result = await cashesCollection.updateOne({ _id: new ObjectId(id) }, { $set: body });
      res.send(result);
    });

    // Post receipt
    app.post("/receipts", async (req, res) => {
      const receipt = req.body;
      const result = await receiptsCollection.insertOne(receipt);
      res.send(result);
    });

    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. Successfully connected to MongoDB!");
  } catch (e) {
    console.error("MongoDB Error:", e.message);
  }
}
run();

// Root route
app.get("/", (req, res) => {
  res.send("Server is running");
});


async function generateArabicTextImage(text, fontSize = 28) {
  const canvas = createCanvas(384, fontSize + 20); // height adjusted automatically
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = "black";
  ctx.font = `${fontSize}px "Arial"`;
  ctx.textAlign = "center";
  ctx.direction = "rtl";
  ctx.fillText(text, 192, fontSize);

  const tempPath = path.join(os.tmpdir(), `${Date.now()}_arabic_text.png`);
  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(tempPath, buffer);

  return new Promise((resolve, reject) => {
    escpos.Image.load(tempPath, (image) => {
      if (image) resolve(image);
      else reject(new Error('Failed to load temp Arabic image'));
    });
  });
}



app.post('/print', async (req, res) => {
  try {
    const {
      customerName,
      mobileNumber,
      services = [],
      products = [],
      total,
      vat,
      paymentType,
      createdAt
    } = req.body;

    const device = new escpos.Network('192.168.8.37');
    const printer = new escpos.Printer(device);

    const createdAtFormatted = new Date(createdAt).toLocaleString();
    const logoPath = path.join(__dirname, 'assets', 'logo.png');

    // Load logo image
    const logo = await new Promise((resolve, reject) => {
      escpos.Image.load(logoPath, (image) => {
        if (image) {
          image.resize(200, 100); // Make logo small
          resolve(image);
        } else reject(new Error('Failed to load logo image'));
      });
    });

    // Render Arabic company name to an image
    const companyNameImage = await generateArabicTextImage("ساعة فرح للترفيه", 28);

    await new Promise((resolve, reject) => {
      device.open(async (error) => {
        if (error) return reject(error);

        try {
          await printer.align('ct');
          await printer.image(logo, 'd24');

          await printer.align('ct');
          await printer.image(companyNameImage, 'd24');

          await printer.align('ct');
          await printer.text('VAT: 6312592186100003');
          await printer.text('------------------------------');

          await printer.align('lt');
          await printer.text(`Customer: ${customerName}`);
          await printer.text(`Mobile: ${mobileNumber}`);
          await printer.text('------------------------------');

          if (services.length > 0) {
            await printer.text('Services:');
            for (let service of services) {
              await printer.text(`${service.name} - ${service.price} SAR`);
            }
            await printer.text('------------------------------');
          }

          if (products.length > 0) {
            await printer.text('Products:');
            for (let product of products) {
              await printer.text(`${product.name} x${product.quantity} - ${(product.price * product.quantity).toFixed(2)} SAR`);
            }
            await printer.text('------------------------------');
          }

          await printer.text(`VAT: ${vat.toFixed(2)} SAR`);
          await printer.text(`Total: ${total.toFixed(2)} SAR`);
          await printer.text(`Payment: ${paymentType}`);
          await printer.text(`Printed: ${createdAtFormatted}`);
          await printer.text('------------------------------');

          await printer.align('ct');
          await printer.text('Thank you for visiting!');
          await printer.cut();
          await printer.close();

          resolve();
        } catch (err) {
          reject(err);
        }
      });
    });

    res.send({ message: 'Printing started.' });

  } catch (err) {
    console.error("Print Error:", err);
    res.status(500).send(`Failed to print receipt: ${err.message}`);
  }
});




// HTTPS Server
const sslOptions = {
  key: fs.readFileSync('key.pem'),
  cert: fs.readFileSync('cert.pem'),
};

https.createServer(sslOptions, app).listen(port, '0.0.0.0', () => {
  console.log("Fun Hour Entertainment HTTPS Server is running 🚀");
});
