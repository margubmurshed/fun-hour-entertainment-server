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

    const logo = await new Promise((resolve, reject) => {
      escpos.Image.load(logoPath, (image) => {
        if (image) resolve(image);
        else reject(new Error('Failed to load logo image'));
      });
    });

    await new Promise((resolve, reject) => {
      device.open(async (error) => {
        if (error) return reject(error);

        try {
          await printer
            .align('ct')
            .image(logo, 's8')
            .then(() => {
              printer
                .size(0, 0)
                .text('ساعة فرح للترفيه')
                .text('VAT: 6312592186100003')
                .text('------------------------------')
                .align('lt')
                .text(`Customer: ${customerName}`)
                .text(`Mobile: ${mobileNumber}`)
                .text(' ')
                .text('Services:')
                .tableCustom(services.map(service => ({
                  text: `${service.name} - ${service.price} SAR`,
                  align: "LEFT",
                  width: 1,
                  style: 'NORMAL'
                })))
                .text(' ')
                .text('Products:')
                .tableCustom(products.map(product => ({
                  text: `${product.name} x ${product.quantity} - ${(product.price * product.quantity).toFixed(2)} SAR`,
                  align: "LEFT",
                  width: 1,
                  style: 'NORMAL'
                })))
                .text(' ')
                .text(`VAT: ${vat.toFixed(2)} SAR`)
                .text(`Total: ${total.toFixed(2)} SAR`)
                .text(`Payment Type: ${paymentType}`)
                .text(' ')
                .text(`Printed At: ${createdAtFormatted}`)
                .align('ct')
                .text('Thank you for visiting!')
                .text('------------------------------')
                .cut()
                .close();
              resolve();
            });
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
