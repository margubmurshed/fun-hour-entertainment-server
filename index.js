const express = require("express");
const https = require('https');
const fs = require('fs');
const fsp = require('fs/promises');
const cors = require("cors");
const sharp = require('sharp');
const { createCanvas } = require('canvas');
const escpos = require("escpos");
escpos.Network = require('escpos-network');
const path = require('path');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use('/assets', express.static('assets'));

const uri = `mongodb+srv://${process.env.DB_USERNAME}:${process.env.DB_PASSWORD}@cluster0.hrq6pyr.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    await client.connect();
    const fheDB = client.db("fheDB");
    const receiptsCollection = fheDB.collection("receipts");
    const cashesCollection = fheDB.collection("cashes");
    const productsCollection = fheDB.collection("products");

    app.get("/receipts", async (req, res) => {
      const result = await receiptsCollection.find().toArray();
      res.send(result);
    });

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

app.get("/", (req, res) => {
  res.send("Server is running");
});

// Save buffer as image
async function saveBufferAsTempImage(buffer, filename = 'temp_image.png') {
  const tempPath = path.join(__dirname, filename);
  await fsp.writeFile(tempPath, buffer);
  return tempPath;
}

// Generate Arabic text image
async function generateArabicTextImage(text, fontSize = 28) {
  const canvas = createCanvas(384, fontSize + 20);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = "black";
  ctx.font = `${fontSize}px "Arial"`;
  ctx.textAlign = "center";
  ctx.direction = "rtl";
  ctx.fillText(text, 192, fontSize);

  const buffer = canvas.toBuffer('image/png');
  const tempPath = path.join(__dirname, `temp_${Date.now()}.png`);
  await fsp.writeFile(tempPath, buffer);
  return tempPath;
}

// Arabic Numbers
function toArabicNumber(n) {
  const arabicNumbers = ['٠','١','٢','٣','٤','٥','٦','٧','٨','٩'];
  return n.toString().split('').map(d => arabicNumbers[+d] || d).join('');
}

// Arabic date formatter
function formatArabicDate(dateObj) {
  return `${toArabicNumber(dateObj.getFullYear())}/${toArabicNumber(dateObj.getMonth() + 1)}/${toArabicNumber(dateObj.getDate())} - ${toArabicNumber(dateObj.getHours())}:${toArabicNumber(dateObj.getMinutes())}`;
}

// Main Print Endpoint
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

    const createdAtFormatted = formatArabicDate(new Date(createdAt));
    const logoPath = path.join(__dirname, 'assets', 'logo.png');

    const resizedLogoBuffer = await sharp(logoPath)
      .resize(200, 100)
      .png()
      .toBuffer();
    const resizedLogoPath = await saveBufferAsTempImage(resizedLogoBuffer, 'temp_logo.png');

    const logo = await new Promise((resolve, reject) => {
      escpos.Image.load(resizedLogoPath, (image) => {
        if (image) resolve(image);
        else reject(new Error('Failed to load logo'));
      });
    });

    const companyNameImagePath = await generateArabicTextImage("ساعة فرح للترفيه");
    const companyNameImage = await new Promise((resolve, reject) => {
      escpos.Image.load(companyNameImagePath, (image) => {
        if (image) resolve(image);
        else reject(new Error('Failed to load company name image'));
      });
    });

    await new Promise((resolve, reject) => {
      device.open(async (error) => {
        if (error) return reject(error);

        try {
          await printer.align('ct');
          await printer.image(logo, 'd24');
          await printer.image(companyNameImage, 'd24');
          await printer.text('------------------------------');

          const vatTextPath = await generateArabicTextImage('الرقم الضريبي: 6312592186100003');
          const vatText = await escpos.Image.load(vatTextPath);
          await printer.image(vatText, 'd24');

          await printer.text('------------------------------');

          const customerTextPath = await generateArabicTextImage(`اسم العميل: ${customerName}`);
          const mobileTextPath = await generateArabicTextImage(`رقم الجوال: ${mobileNumber}`);
          await printer.image(await escpos.Image.load(customerTextPath));
          await printer.image(await escpos.Image.load(mobileTextPath));
          await printer.text('------------------------------');

          if (services.length > 0) {
            const servicesTitlePath = await generateArabicTextImage('الخدمات:');
            await printer.image(await escpos.Image.load(servicesTitlePath));

            for (let i = 0; i < services.length; i++) {
              const service = services[i];
              const text = `${toArabicNumber(i + 1)}. ${service.name} - ${toArabicNumber(service.price)} ر.س`;
              const textPath = await generateArabicTextImage(text);
              await printer.image(await escpos.Image.load(textPath));
            }
            await printer.text('------------------------------');
          }

          if (products.length > 0) {
            const productsTitlePath = await generateArabicTextImage('المنتجات:');
            await printer.image(await escpos.Image.load(productsTitlePath));

            for (let i = 0; i < products.length; i++) {
              const product = products[i];
              const text = `${toArabicNumber(i + 1)}. ${product.name} ×${toArabicNumber(product.quantity)} - ${toArabicNumber((product.price * product.quantity).toFixed(2))} ر.س`;
              const textPath = await generateArabicTextImage(text);
              await printer.image(await escpos.Image.load(textPath));
            }
            await printer.text('------------------------------');
          }

          const vatAmountPath = await generateArabicTextImage(`ضريبة القيمة المضافة: ${toArabicNumber(vat.toFixed(2))} ر.س`);
          const totalAmountPath = await generateArabicTextImage(`الإجمالي: ${toArabicNumber(total.toFixed(2))} ر.س`);
          const paymentTypePath = await generateArabicTextImage(`طريقة الدفع: ${paymentType}`);
          const printedAtPath = await generateArabicTextImage(`تاريخ الطباعة: ${createdAtFormatted}`);
          const vatNotePath = await generateArabicTextImage('شامل ضريبة القيمة المضافة 15٪');

          await printer.image(await escpos.Image.load(vatAmountPath));
          await printer.image(await escpos.Image.load(totalAmountPath));
          await printer.image(await escpos.Image.load(paymentTypePath));
          await printer.image(await escpos.Image.load(printedAtPath));
          await printer.image(await escpos.Image.load(vatNotePath));

          await printer.text('------------------------------');

          const thankYouPath = await generateArabicTextImage('شكراً لزيارتكم');
          await printer.image(await escpos.Image.load(thankYouPath));

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

const sslOptions = {
  key: fs.readFileSync('key.pem'),
  cert: fs.readFileSync('cert.pem'),
};

https.createServer(sslOptions, app).listen(port, '0.0.0.0', () => {
  console.log("Fun Hour Entertainment HTTPS Server is running 🚀");
});
