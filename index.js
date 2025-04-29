// index.js

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

    app.get("/receipts/cash-session/:cashId", async (req, res) => {
      try {
        const cashId = req.params.cashId;

        const cash = await cashesCollection.findOne({ _id: new ObjectId(cashId) });

        if (!cash) {
          return res.status(404).send({ message: "Cash session not found." });
        }

        const receipts = await receiptsCollection.find({
          cashId: cashId  // find receipts by cashId
        }).toArray();

        res.send(receipts);
      } catch (error) {
        console.error("Failed to fetch receipts for cash session:", error);
        res.status(500).send({ message: "Internal server error." });
      }
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

    app.post('/receipts', async (req, res) => {
      try {
        const receiptData = req.body;
        const { cashId } = receiptData;

        if (!cashId) {
          return res.status(400).json({ message: "Missing cashId in receipt" });
        }

        // How many receipts exist for this cash session?
        const count = await receiptsCollection.countDocuments({ cashId });

        // Assign serial
        receiptData.serial = count + 1;

        // 🛠 Ensure createdAt is number (timestamp in ms)
        if (!receiptData.createdAt) {
          receiptData.createdAt = Date.now(); // 👈 returns timestamp number
        } else if (typeof receiptData.createdAt !== 'number') {
          receiptData.createdAt = new Date(receiptData.createdAt).getTime();
        }

        // Insert receipt
        const result = await receiptsCollection.insertOne(receiptData);

        res.status(201).json({ insertedId: result.insertedId, serial: receiptData.serial });
      } catch (error) {
        console.error("Failed to save receipt:", error);
        res.status(500).json({ message: "Failed to save receipt" });
      }
    });



    const saveArabicTextAsImage = async (text, filename, fontSize = 28) => {
      const canvasWidth = 576; // For 80mm paper width (Bixolon SRP-E300)
      const canvas = createCanvas(canvasWidth, fontSize + 30);
      const ctx = canvas.getContext("2d");
    
      ctx.fillStyle = "black";
      ctx.font = `${fontSize}px "Arial"`;
      ctx.textAlign = "right"; // Proper alignment for Arabic
      ctx.direction = "rtl";
    
      const padding = 20;
      ctx.fillText(text, canvasWidth - padding, fontSize + 5); // draw text with padding
    
      const buffer = canvas.toBuffer("image/png");
      const filePath = path.join(__dirname, 'temp', filename);
      fs.writeFileSync(filePath, buffer);
      return filePath;
    };
    

    const toArabicNumber = (number) => {
      if (number === undefined || number === null) return '';
      const arabicNumbers = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
      return number.toString().split('').map(digit => arabicNumbers[digit] || digit).join('');
    };


    // Ensure temp folder exists
    if (!fs.existsSync(path.join(__dirname, 'temp'))) {
      fs.mkdirSync(path.join(__dirname, 'temp'));
    }

    // /print endpoint
    app.post("/print", async (req, res) => {
      const { receiptId } = req.body;
      try {
        const receipt = await receiptsCollection.findOne({ _id: new ObjectId(receiptId) });
        const {
          customerName,
          mobileNumber,
          services = [],
          products = [],
          total,
          vat,
          paymentType,
          createdAt,
          serial
        } = receipt;


        const device = new escpos.Network("192.168.8.37");
        const printer = new escpos.Printer(device);

        const createdAtFormatted = new Date(createdAt).toLocaleString("ar-EG");

        const logoPath = path.join(__dirname, "assets", "logo.png");

        await new Promise((resolve, reject) => {
          device.open(async (error) => {
            if (error) return reject(error);

            try {
              await printer.align("ct");

              // Resize logo and save temporarily
              const resizedLogoPath = path.join(__dirname, "temp", "logo_resized.png");
              await sharp(logoPath).resize(200, 100).toFile(resizedLogoPath);

              const logoImage = await new Promise((resolve, reject) => {
                escpos.Image.load(resizedLogoPath, (image) => {
                  if (image) resolve(image);
                  else reject(new Error("Failed to load logo image"));
                });
              });

              await printer.image(logoImage, "d24");

              // Company Name
              const companyNamePath = await saveArabicTextAsImage("ساعة فرح للترفيه", "company_name.png", 32);
              const companyNameImage = await new Promise((resolve, reject) => {
                escpos.Image.load(companyNamePath, (img) => {
                  if (img) resolve(img);
                  else reject(new Error("Failed to load company name image"));
                });
              });

              await printer.image(companyNameImage, "d24");

              await printer.text("VAT : 6312592186100003");
              await printer.text("--------------------------------");

              // Serial Number
              const serialInArabic = toArabicNumber(serial);
              const serialPath = await saveArabicTextAsImage(`رقم التسلسل: ${serialInArabic}`, "serial.png");
              const serialImage = await new Promise((resolve, reject) => {
                escpos.Image.load(serialPath, (img) => img ? resolve(img) : reject(new Error("Failed to load")));
              });
              await printer.image(serialImage, "d24");

              // Customer Info
              const customerNamePath = await saveArabicTextAsImage(`اسم العميل: ${customerName}`, "customer_name.png");
              const mobileNumberPath = await saveArabicTextAsImage(`رقم الجوال: ${mobileNumber}`, "mobile_number.png");
              const createdAtPath = await saveArabicTextAsImage(`التاريخ: ${createdAtFormatted}`, "created_at.png");

              const customerNameImage = await new Promise((resolve, reject) => {
                escpos.Image.load(customerNamePath, (img) => img ? resolve(img) : reject(new Error("Failed to load")));
              });
              const mobileNumberImage = await new Promise((resolve, reject) => {
                escpos.Image.load(mobileNumberPath, (img) => img ? resolve(img) : reject(new Error("Failed to load")));
              });
              const createdAtImage = await new Promise((resolve, reject) => {
                escpos.Image.load(createdAtPath, (img) => img ? resolve(img) : reject(new Error("Failed to load")));
              });

              await printer.image(customerNameImage, "d24");
              await printer.image(mobileNumberImage, "d24");
              await printer.image(createdAtImage, "d24");
              await printer.text("--------------------------------");

              let counter = 1;

              if (services.length > 0) {
                const serviceHeaderPath = await saveArabicTextAsImage("الخدمات:", "services_header.png");
                const serviceHeaderImage = await new Promise((resolve, reject) => {
                  escpos.Image.load(serviceHeaderPath, (img) => img ? resolve(img) : reject(new Error("Failed to load")));
                });
                await printer.image(serviceHeaderImage, "d24");

                for (const service of services) {
                  const serviceLine = `${service.name} - ${service.price} ريال`;
                  const servicePath = await saveArabicTextAsImage(serviceLine, `service_${counter}.png`);
                  const serviceImage = await new Promise((resolve, reject) => {
                    escpos.Image.load(servicePath, (img) => img ? resolve(img) : reject(new Error("Failed to load")));
                  });
                  await printer.image(serviceImage, "d24");
                }
                await printer.text("--------------------------------");
              }

              if (products.length > 0) {
                const productsHeaderPath = await saveArabicTextAsImage("المنتجات:", "products_header.png");
                const productsHeaderImage = await new Promise((resolve, reject) => {
                  escpos.Image.load(productsHeaderPath, (img) => img ? resolve(img) : reject(new Error("Failed to load")));
                });
                await printer.image(productsHeaderImage, "d24");

                for (const product of products) {
                  const productLine = `${product.name} ×${product.quantity} - ${(product.price * product.quantity).toFixed(2)} ريال`;
                  const productPath = await saveArabicTextAsImage(productLine, `product_${counter}.png`);
                  const productImage = await new Promise((resolve, reject) => {
                    escpos.Image.load(productPath, (img) => img ? resolve(img) : reject(new Error("Failed to load")));
                  });
                  await printer.image(productImage, "d24");
                }
                await printer.text("--------------------------------");
              }

              // Total and Payment
              const vatPath = await saveArabicTextAsImage(`ضريبة القيمة المضافة: ${vat.toFixed(2)} ريال`, "vat.png");
              const totalPath = await saveArabicTextAsImage(`الإجمالي: ${total.toFixed(2)} ريال`, "total.png");
              const paymentPath = await saveArabicTextAsImage(`طريقة الدفع: ${paymentType}`, "payment.png");
              const vatIncludedPath = await saveArabicTextAsImage("15% ضريبة القيمة المضافة مشمولة في الإجمالي", "vat_included.png");

              const vatImage = await new Promise((resolve, reject) => {
                escpos.Image.load(vatPath, (img) => img ? resolve(img) : reject(new Error("Failed to load")));
              });
              const totalImage = await new Promise((resolve, reject) => {
                escpos.Image.load(totalPath, (img) => img ? resolve(img) : reject(new Error("Failed to load")));
              });
              const paymentImage = await new Promise((resolve, reject) => {
                escpos.Image.load(paymentPath, (img) => img ? resolve(img) : reject(new Error("Failed to load")));
              });
              const vatIncludedImage = await new Promise((resolve, reject) => {
                escpos.Image.load(vatIncludedPath, (img) => img ? resolve(img) : reject(new Error("Failed to load")));
              });

              await printer.image(vatImage, "d24");
              await printer.image(totalImage, "d24");
              await printer.image(paymentImage, "d24");
              await printer.image(vatIncludedImage, "d24");

              await printer.text("--------------------------------");

              const thankYouPath = await saveArabicTextAsImage("شكراً لزيارتكم!", "thank_you.png");
              const thankYouImage = await new Promise((resolve, reject) => {
                escpos.Image.load(thankYouPath, (img) => img ? resolve(img) : reject(new Error("Failed to load")));
              });
              await printer.image(thankYouImage, "d24");

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



    app.post("/print-cash", async (req, res) => {
      const { cashierName, cashierEmail, cashId } = req.body;
      console.log(req.body)
      try {
        const cash = await cashesCollection.findOne({ _id: new ObjectId(cashId) });
        if (!cash) return res.status(404).send({ message: "Cash session not found" });

        const {
          openingCashAmount,
          openingCashTime,
          closingCashAmount,
          closingCashTime
        } = cash;

        const receipts = await receiptsCollection.find({ cashId }).toArray();

        // Grouping logic as before...
        const productsMap = new Map();
        const servicesMap = new Map();
        let totalProducts = 0, totalServices = 0;

        for (const receipt of receipts) {
          for (const p of receipt.products || []) {
            const existing = productsMap.get(p.name) || { quantity: 0, total: 0, price: p.price };
            existing.quantity += p.quantity;
            existing.total += p.quantity * p.price;
            productsMap.set(p.name, existing);
            totalProducts += p.quantity * p.price;
          }
          for (const s of receipt.services || []) {
            const existing = servicesMap.get(s.name) || { times: 0, total: 0, price: s.price };
            existing.times += 1;
            existing.total += s.price;
            servicesMap.set(s.name, existing);
            totalServices += s.price;
          }
        }

        // sales summary
        let totalProductSales = 0;
        receipts.forEach(receipt => {
          receipt.products.forEach(product => {
            totalProductSales += product.price * product.quantity;
          });
        });

        let totalServicesSales = 0;
        receipts.forEach(receipt => {
          receipt.services.forEach(service => {
            totalServicesSales += service.price;
          });
        });

        let totalCash = 0;
        let totalCard = 0;

        receipts.forEach(receipt => {
          if (receipt.paymentType === 'cash') totalCash += receipt.total;
          else if (receipt.paymentType === 'card') totalCard += receipt.total;
        });

        const cashDifference = closingCashAmount - totalCash;



        const device = new escpos.Network("192.168.8.37");
        const printer = new escpos.Printer(device);

        const logoPath = path.join(__dirname, "assets", "logo.png");
        const printedAtFormatted = new Date().toLocaleString("ar-EG");

        await new Promise((resolve, reject) => {
          device.open(async (error) => {
            if (error) return reject(error);

            try {
              await printer.align("ct");

              // Logo
              const resizedLogoPath = path.join(__dirname, "temp", "logo_resized.png");
              await sharp(logoPath).resize(200, 100).toFile(resizedLogoPath);
              const logoImage = await new Promise((resolve, reject) => {
                escpos.Image.load(resizedLogoPath, (image) => {
                  if (image) resolve(image);
                  else reject(new Error("Failed to load logo image"));
                });
              });
              await printer.image(logoImage, "d24");

              // Print Time
              const printedAtPath = await saveArabicTextAsImage(`وقت الطباعة: ${printedAtFormatted}`, "printed_at.png");
              const printedAtImage = await new Promise((resolve, reject) => {
                escpos.Image.load(printedAtPath, (img) => img ? resolve(img) : reject(new Error("Failed to load")));
              });
              await printer.image(printedAtImage, "d24");
              await printer.text("--------------------------------");

              // Session Info Section (NEW)
              const lines = [
                `اسم الكاشير: ${cashierName}`,
                `بريد الكاشير: ${cashierEmail}`,
                `بداية الجلسة: ${new Date(openingCashTime).toLocaleString("ar-EG")}`,
                `المبلغ الافتتاحي: ${openingCashAmount} ريال`,
                `نهاية الجلسة: ${new Date(closingCashTime).toLocaleString("ar-EG")}`,
                `المبلغ الختامي: ${closingCashAmount} ريال`,
              ];

              for (const [i, text] of lines.entries()) {
                const imagePath = await saveArabicTextAsImage(text, `session_line_${i}.png`);
                const img = await new Promise((resolve, reject) => {
                  escpos.Image.load(imagePath, (img) => img ? resolve(img) : reject(new Error("Failed to load")));
                });
                await printer.image(img, "d24");
              }

              await printer.text("--------------------------------");

              // Products Section
              if (productsMap.size > 0) {
                const headerPath = await saveArabicTextAsImage("المنتجات المباعة اليوم", "header_products.png", 30);
                const headerImage = await new Promise((resolve, reject) => {
                  escpos.Image.load(headerPath, (img) => img ? resolve(img) : reject(new Error("Failed to load")));
                });
                await printer.image(headerImage, "d24");

                for (const [name, data] of productsMap.entries()) {
                  const line = `${name} ×${data.quantity} - ${data.total.toFixed(2)} ريال`;
                  const pathP = await saveArabicTextAsImage(line, `product_line_${name}.png`);
                  const img = await new Promise((resolve, reject) => {
                    escpos.Image.load(pathP, (img) => img ? resolve(img) : reject(new Error("Failed to load")));
                  });
                  await printer.image(img, "d24");
                }

                await printer.text("--------------------------------");
              }

              // Services Section
              if (servicesMap.size > 0) {
                const headerPath = await saveArabicTextAsImage("الخدمات المباعة اليوم", "header_services.png", 30);
                const headerImage = await new Promise((resolve, reject) => {
                  escpos.Image.load(headerPath, (img) => img ? resolve(img) : reject(new Error("Failed to load")));
                });
                await printer.image(headerImage, "d24");

                for (const [name, data] of servicesMap.entries()) {
                  const line = `${name} ×${data.times} - ${data.total.toFixed(2)} ريال`;
                  const pathS = await saveArabicTextAsImage(line, `service_line_${name}.png`);
                  const img = await new Promise((resolve, reject) => {
                    escpos.Image.load(pathS, (img) => img ? resolve(img) : reject(new Error("Failed to load")));
                  });
                  await printer.image(img, "d24");
                }

                await printer.text("--------------------------------");
              }

              // Total Section
              const totalAll = totalProducts + totalServices;
              const totalPath = await saveArabicTextAsImage(`الإجمالي الكلي: ${totalAll.toFixed(2)} ريال`, "total_all.png", 28);
              const totalImage = await new Promise((resolve, reject) => {
                escpos.Image.load(totalPath, (img) => img ? resolve(img) : reject(new Error("Failed to load")));
              });
              await printer.image(totalImage, "d24");

              const totalsToPrint = [
                `إجمالي مبيعات المنتجات: ${totalProductSales.toFixed(2)} ريال`,
                `إجمالي مبيعات الخدمات: ${totalServicesSales.toFixed(2)} ريال`,
                `إجمالي المدفوع نقداً: ${totalCash.toFixed(2)} ريال`,
                `إجمالي المدفوع بالبطاقة: ${totalCard.toFixed(2)} ريال`,
                `الفرق النقدي: ${cashDifference.toFixed(2)} ريال`
              ];
              
              for (const [i, text] of totalsToPrint.entries()) {
                const imagePath = await saveArabicTextAsImage(text, `summary_line_${i}.png`);
                const img = await new Promise((resolve, reject) => {
                  escpos.Image.load(imagePath, (img) => img ? resolve(img) : reject(new Error("Failed to load")));
                });
                await printer.image(img, "d24");
              }
              

              await printer.cut();
              await printer.close();
              resolve();
            } catch (e) {
              reject(e);
            }
          });
        });

        res.send({ message: "تمت طباعة تقرير الجلسة." });
      } catch (err) {
        console.error("خطأ أثناء طباعة تقرير الجلسة:", err);
        res.status(500).send({ message: "فشل في الطباعة" });
      }
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




// HTTPS Server
const sslOptions = {
  key: fs.readFileSync("key.pem"),
  cert: fs.readFileSync("cert.pem"),
};

https.createServer(sslOptions, app).listen(port, "0.0.0.0", () => {
  console.log("🚀 خادم ساعة فرح يعمل على HTTPS");
});

