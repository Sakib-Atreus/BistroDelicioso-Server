require("dotenv").config();
const express = require("express");
const app = express();
const cors = require("cors");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const mg = require('nodemailer-mailgun-transport');
const stripe = require('stripe')(process.env.PAYMENT_SECRET_KEY)
const port = process.env.PORT || 5000;

// middleware
app.use(cors());
app.use(express.json());


// let transporter = nodemailer.createTransport({
//   host: 'smtp.sendgrid.net',
//   port: 587,
//   auth: {
//       user: process.env.EMAIL_PRIVATE_KEY,
//       pass: process.env.EMAIL_DOMAIN_KEY
//   }
// })

const auth = {
  auth: {
    api_key: process.env.EMAIL_PRIVATE_KEY,
    domain: process.env.EMAIL_DOMAIN_KEY
  }
}

const transporter = nodemailer.createTransport(mg(auth));


// send payment confirmation email
const sendPaymentConfirmationEmail = payment => {
  transporter.sendMail({
    from: "sakibatreus@gmail.com", // verified sender email
    to: "sakibatreus@gmail.com", // recipient email
    subject: "Your order is confirmed. Enjoy the food soon.", // Subject line
    text: "Hello!", // plain text body
    html: `
    <div>
      <h2>Payment Confirmed!!</h2>
      <p>Transaction id: ${payment.transactionId}</p>
    </div>`, // html body
  }, function(error, info){
    if (error) {
      console.log(error);
    } else {
      console.log('Email sent: ' + info.response);
    }
  });
}

// JWT Verify Token
const verifyJWT = (req, res, next) => {
  const authorization = req.headers.authorization;
  if (!authorization) {
    return res
      .status(401)
      .send({ error: true, message: "unauthorized access" });
  }
  // bearer token
  const token = authorization.split(" ")[1];

  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      return res
        .status(401)
        .send({ error: true, message: "unauthorized access" });
    }
    req.decoded = decoded;
    next();
  });
};

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.sktmpwb.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const usersCollection = client.db("bistroDB").collection("users");
    const menuCollection = client.db("bistroDB").collection("menu");
    const reviewCollection = client.db("bistroDB").collection("reviews");
    const cartCollection = client.db("bistroDB").collection("carts");
    const paymentCollection = client.db("bistroDB").collection("payments");

    // JWT: Json Web Token
    app.post("/jwt", (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "1h",
      });
      res.send({ token });
    });

    // Warning: use verifyJWT before using verifyAdmin
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      const isAdmin = user?.role === "admin";
      if (!isAdmin) {
        return res
          .status(403)
          .send({ error: true, message: "forbidden message" });
      }
      next();
    };

    /*
     * 0. Do not show secure links to those who should not see the links
     * 1. use jwt token: verifyJWT
     * 2. Use verifyAdmin middleware
     */
    //   ********   user related apis    *********
    app.get("/users", verifyJWT, verifyAdmin, async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.send(result);
    });

    app.post("/users", async (req, res) => {
      const user = req.body;
      // console.log(user);
      const query = { email: user.email };
      const existingUser = await usersCollection.findOne(query);
      // console.log('Existing User:', existingUser);
      if (existingUser) {
        return res.send({ message: "User Already Exists!" });
      }
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    // security layer: verifyJWT
    // email same
    // check admin
    app.get("/users/admin/:email", verifyJWT, async (req, res) => {
      const email = req.params.email;

      if (req.decoded.email !== email) {
        res.send({ admin: false });
      }

      const query = { email: email };
      const user = await usersCollection.findOne(query);
      const result = { admin: user?.role === "admin" };
      res.send(result);
    });

    app.patch("/users/admin/:id", async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          role: "admin",
        },
      };

      const result = await usersCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    //   ********   menu related apis   ********
    app.get("/menu", async (req, res) => {
      const result = await menuCollection.find().toArray();
      res.send(result);
    });

    app.post("/menu", verifyJWT, verifyAdmin, async (req, res) => {
      const newItem = req.body;
      const result = await menuCollection.insertOne(newItem);
      res.send(result);
    });

    app.delete("/menu/:id", verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await menuCollection.deleteOne(query);
      res.send(result);
    });

    //   ********   reviews related apis   ********
    app.get("/review", async (req, res) => {
      const result = await reviewCollection.find().toArray();
      res.send(result);
    });

    //   ********   Cart Collection   ********

    app.get("/carts", verifyJWT, async (req, res) => {
      const email = req.query.email;
      // console.log(email);
      if (!email) {
        res.send([]);
      }

      const decodedEmail = req.decoded.email;
      if (email !== decodedEmail) {
        return res
          .status(403)
          .send({ error: true, message: "forbidden access" });
      }

      const query = { email: email };
      const result = await cartCollection.find(query).toArray();
      res.send(result);
    });

    app.post("/carts", async (req, res) => {
      const item = req.body;
      // console.log(item);
      const result = await cartCollection.insertOne(item);
      res.send(result);
    });

    app.delete("/carts/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) }; // Convert id to ObjectId
        const result = await cartCollection.deleteOne(query);

        if (result.deletedCount === 1) {
          res.status(200).json({ message: "Item deleted successfully" });
        } else {
          res.status(404).json({ error: "Item not found" });
        }
      } catch (error) {
        console.error("Error deleting item:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // create payment intent
    app.post('/create-payment-intent', verifyJWT, async(req, res) => {
      const {price} = req.body;
      const amount = parseInt(price * 100);

      console.log(price, amount);

      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: 'usd',
        payment_method_types: ['card'] 
      });
      res.send({
        clientSecret: paymentIntent.client_secret
      });
    });

    //  payment related api
    app.post('/payments', verifyJWT, async(req, res) => {
      const payment = req.body;
      const insertResult = await paymentCollection.insertOne(payment);

      const query = { _id: { $in: payment.cartItems.map(id => new ObjectId(id)) }}
      const deleteResult = await cartCollection.deleteMany(query);

      // send an email confirming order
      sendPaymentConfirmationEmail(payment);

      res.send({ insertResult, deleteResult});
    })





    // ************************************************************************

    // User Home
    app.get('user-stats', verifyJWT, async(req, res) => {
      const products = await menuCollection.estimatedDocumentCount();
      const orders = await cartCollection.estimatedDocumentCount();
      const review = await reviewCollection.estimatedDocumentCount();

      //  best way to get sum of the price field is to use group and sum operator

      const payments = await paymentCollection.find().toArray();
      const revenue = payments.reduce( ( sum, payment) => parseFloat(sum + payment.price), 0).toFixed(2)

      res.send({
        products,
        orders,
        review,
        revenue
      })
    })

    app.get('/user-order-stats', verifyJWT, async(req, res) => {
      const pipeline = [
        {
          $lookup: {
            from: 'menu',
            localField: 'menuItems',
            foreignField: '_id',
            as: 'menuItemsData'
          }
        },
        {
          $unwind: '$menuItemsData'
        },
        {
          $group: {
            _id: '$menuItemsData.category',
            count: { $sum: 1},
            total: { $sum: '$menuItemsData.price' }
          }
        },
        {
          $project: {
            category: '$_id',
            count: 1,
            total: { $round: ['$total', 2] },
            _id: 0
          }
        }
      ];

      const result = await paymentCollection.aggregate(pipeline).toArray();
      res.send(result);
    })

    // ******************************************************************************





    
    // Admin Home
    app.get('/admin-stats', verifyJWT, verifyAdmin, async(req, res) => {
      const users = await usersCollection.estimatedDocumentCount();
      const products = await menuCollection.estimatedDocumentCount();
      const orders = await paymentCollection.estimatedDocumentCount();

      //  best way to get sum of the price field is to use group and sum operator

      const payments = await paymentCollection.find().toArray();
      const revenue = payments.reduce( ( sum, payment) => parseFloat(sum + payment.price), 0).toFixed(2)

      res.send({
        users,
        products,
        orders,
        revenue
      })
    })

    app.get('/order-stats', verifyJWT, verifyAdmin, async(req, res) => {
      const pipeline = [
        {
          $lookup: {
            from: 'menu',
            localField: 'menuItems',
            foreignField: '_id',
            as: 'menuItemsData'
          }
        },
        {
          $unwind: '$menuItemsData'
        },
        {
          $group: {
            _id: '$menuItemsData.category',
            count: { $sum: 1},
            total: { $sum: '$menuItemsData.price' }
          }
        },
        {
          $project: {
            category: '$_id',
            count: 1,
            total: { $round: ['$total', 2] },
            _id: 0
          }
        }
      ];

      const result = await paymentCollection.aggregate(pipeline).toArray();
      res.send(result);
    })




    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Boss is Relaxing...!");
});

app.listen(port, () => {
  console.log(`Bistro Boss is Relaxing on Port ${port}`);
});
