const express = require("express");
const https = require("https");
const fs = require("fs");
const cors = require("cors");
const sharp = require("sharp");
const { createCanvas } = require("canvas");
const escpos = require("escpos");
escpos.Network = require("escpos-network");
require("dotenv").config();
const path = require("path");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const app = express();
const port = process.env.PORT || 5000;

// Middleware
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

// Helper: generate Arabic text as image buffer
async function generateArabicTextBuffer(text, fontSize = 28) {
  const canvas = createCanvas(384, fontSize + 20);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "black";
  ctx.font = `${fontSize}px "Arial"`;
  ctx.textAlign = "center";
  ctx.direction = "rtl"; // Arabic Right-to-Left
  ctx.fillText(text, 192, fontSize);

  return canvas.toBuffer("image/png");
}

// /print endpoint
app.post("/print", async (req, res) => {
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

    const device = new escpos.Network("192.168.8.37");
    const printer = new escpos.Printer(device);

    const createdAtFormatted = new Date(createdAt).toLocaleString("ar-EG");

    // Load logo and resize
    const logoPath = path.join(__dirname, "assets", "logo.png");
    const resizedLogoBuffer = await sharp(logoPath).resize(200, 100).png().toBuffer();

    const logoImage = await new Promise((resolve, reject) => {
      escpos.Image.load(resizedLogoBuffer, (image) => {
        if (image) resolve(image);
        else reject(new Error("فشل تحميل الشعار"));
      });
    });

    await new Promise((resolve, reject) => {
      device.open(async (error) => {
        if (error) return reject(error);

        try {
          await printer.align("ct");
          await printer.image(logoImage, "d24");

          // Company Name in Arabic
          const companyNameBuffer = await generateArabicTextBuffer("ساعة فرح للترفيه", 32);
          const companyNameImage = await new Promise((resolve, reject) => {
            escpos.Image.load(companyNameBuffer, (img) => {
              if (img) resolve(img);
              else reject(new Error("فشل تحميل اسم الشركة"));
            });
          });

          await printer.align("ct");
          await printer.image(companyNameImage, "d24");

          await printer.align("ct");
          await printer.text("الرقم الضريبي: 6312592186100003");
          await printer.text("--------------------------------");

          // Customer Info
          const customerBuffer = await generateArabicTextBuffer(`اسم العميل: ${customerName}`);
          const mobileBuffer = await generateArabicTextBuffer(`رقم الجوال: ${mobileNumber}`);
          const dateBuffer = await generateArabicTextBuffer(`التاريخ: ${createdAtFormatted}`);

          await printer.image(customerBuffer, "d24");
          await printer.image(mobileBuffer, "d24");
          await printer.image(dateBuffer, "d24");
          await printer.text("--------------------------------");

          let counter = 1;

          if (services.length > 0) {
            const serviceHeader = await generateArabicTextBuffer("الخدمات:");
            await printer.image(serviceHeader, "d24");

            for (let service of services) {
              const serviceLine = `${counter++}- ${service.name} - ${service.price} ريال`;
              const serviceBuffer = await generateArabicTextBuffer(serviceLine);
              await printer.image(serviceBuffer, "d24");
            }
            await printer.text("--------------------------------");
          }

          if (products.length > 0) {
            const productHeader = await generateArabicTextBuffer("المنتجات:");
            await printer.image(productHeader, "d24");

            for (let product of products) {
              const productLine = `${counter++}- ${product.name} ×${product.quantity} - ${(product.price * product.quantity).toFixed(2)} ريال`;
              const productBuffer = await generateArabicTextBuffer(productLine);
              await printer.image(productBuffer, "d24");
            }
            await printer.text("--------------------------------");
          }

          // Total and Payment
          const vatBuffer = await generateArabicTextBuffer(`ضريبة القيمة المضافة: ${vat.toFixed(2)} ريال`);
          const totalBuffer = await generateArabicTextBuffer(`الإجمالي: ${total.toFixed(2)} ريال`);
          const paymentBuffer = await generateArabicTextBuffer(`طريقة الدفع: ${paymentType}`);
          const vatIncludedBuffer = await generateArabicTextBuffer("15% ضريبة القيمة المضافة مشمولة في الإجمالي");

          await printer.image(vatBuffer, "d24");
          await printer.image(totalBuffer, "d24");
          await printer.image(paymentBuffer, "d24");
          await printer.image(vatIncludedBuffer, "d24");

          await printer.text("--------------------------------");

          // Footer
          const thankYouBuffer = await generateArabicTextBuffer("شكراً لزيارتكم!");
          await printer.image(thankYouBuffer, "d24");

          await printer.cut();
          await printer.close();

          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });

    res.send({ message: "تم بدء الطباعة." });

  } catch (error) {
    console.error("خطأ في الطباعة:", error);
    res.status(500).send(`فشل في الطباعة: ${error.message}`);
  }
});

// HTTPS Server
const sslOptions = {
  key: fs.readFileSync("key.pem"),
  cert: fs.readFileSync("cert.pem"),
};

https.createServer(sslOptions, app).listen(port, "0.0.0.0", () => {
  console.log("🚀 خادم ساعة فرح يعمل على HTTPS");
});