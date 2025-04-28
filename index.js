const express = require("express");
const https = require('https');
const fs = require('fs');
const cors = require("cors");
const escpos = require("escpos");
escpos.Network = require('escpos-network');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const app = express();
const port = process.env.PORT || 5000;
require('dotenv').config();


app.use(cors());
app.use(express.json())

console.log(process.env.DB_USERNAME)

const uri = `mongodb+srv://${process.env.DB_USERNAME}:${process.env.DB_PASSWORD}@cluster0.hrq6pyr.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    

    const fheDB = client.db("fheDB");
    const receiptsCollection = fheDB.collection("receipts");
    const cashesCollection = fheDB.collection("cashes");
    const productsCollection = fheDB.collection("products");

    app.get("/receipts", async(req, res) => {
        const cursor = receiptsCollection.find();
        const result = await cursor.toArray();
        res.send(result)
    })

    app.get("/cashes", async(req, res) => {
      const cursor = cashesCollection.find();
      const result = await cursor.toArray();
      res.send(result)
    })

    app.get("/cashes/:email", async (req, res) => {
      const email = req.params.email;
    
      const result = await cashesCollection.findOne({
        cashierEmail: email,
        closingCashAmount: null, 
      });
    
      res.send(result);
    });

    app.get("/products", async(req, res) => {
      const cursor = productsCollection.find();
      const result = await cursor.toArray();
      res.send(result)
    })

    app.post("/cashes", async(req, res) => {
      console.log(req.body, "post cashes")
      const data = req.body;
      const result = await cashesCollection.insertOne(data);
        res.send(result)
    })

    app.post("/receipts", async(req, res) => {
        const receipt = req.body;
        const result = await receiptsCollection.insertOne(receipt);
        res.send(result)
    })
    app.post("/products", async(req, res) => {
        const product = req.body;
        const result = await productsCollection.insertOne(product);
        res.send(result)
    })

    app.put("/products/:id", async(req, res) => {
      const id = req.params.id;
      const body = req.body;
      const result = await productsCollection.updateOne({_id: new ObjectId(id)}, {$set: body});
      res.send(result);
    })
  

    app.patch("/cashes/:id", async(req, res) => {
      const id = req.params.id;
      const body = req.body;
      const result = await cashesCollection.updateOne({_id: new ObjectId(id)}, {$set: body});
      res.send(result);
    })

    app.delete("/products/:id", async(req,res) => {
      const id = req.params.id;
      const result = await productsCollection.deleteOne({_id: new ObjectId(id)});
      res.send(result);
    })

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } catch(e) {
    console.log(e.message)
  }
}
run();


app.get("/", (req, res) => {
    res.send("Server is running")
})

app.post('/print', async (req, res) => {
  try {
    console.log("Received print request:", req.body);
    const { customerName, mobileNumber, services, products, total, vat, paymentType, createdAt } = req.body;

    const device = new escpos.Network('192.168.8.37'); // Your printer IP
    const printer = new escpos.Printer(device);

    device.open(function () {
      const createdAtFormatted = new Date(createdAt).toLocaleString(); // Format nicely

      printer
        .align('ct')
        .style('b')
        .size(0, 0) // small font
        .text('    Fun Hour Entertainment    ')
        .text('------------------------------')
        .align('lt')
        .text(` Customer: ${customerName}`)
        .text(` Mobile: ${mobileNumber}`)
        .text(' ')
        .text(' Services:')
        .tableCustom(
          services.map(service => ({
            text: `${service.name} - ${service.price} SAR`,
            align: "LEFT",
            width: 1,
            style: 'NORMAL'
          }))
        )
        .text(' ')
        .text(' Products:')
        .tableCustom(
          products.map(product => ({
            text: `${product.name} x ${product.quantity} - ${(product.price * product.quantity).toFixed(2)} SAR`,
            align: "LEFT",
            width: 1,
            style: 'NORMAL'
          }))
        )
        .text(' ')
        .text(` VAT: ${vat.toFixed(2)} SAR`)
        .text(` Total: ${total.toFixed(2)} SAR`)
        .text(` Payment Type: ${paymentType}`)
        .text(' ')
        .text(` Printed At: ${createdAtFormatted}`)
        .align('ct')
        .text('Thank you for visiting!')
        .text('------------------------------')
        .cut()
        .close();
    });

    res.send({ message: 'Printing...' });
  } catch (err) {
    console.error(err);
    res.status(500).send(`Failed to print receipt: ${err.message}`);
  }
});


// Read SSL certs
const sslOptions = {
  key: fs.readFileSync('key.pem'),
  cert: fs.readFileSync('cert.pem'),
};

https.createServer(sslOptions, app).listen(port, '0.0.0.0', () => {
  console.log("Fun Hour Entertainment HTTPS Server is running 🚀");
  console.log(`Access it at: https://192.168.0.102:${port}/`);
});