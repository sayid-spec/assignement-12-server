const express = require("express");
const app = express();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const cors = require("cors");
const ImageKit = require("imagekit");
const fs = require("fs");
var jwt = require("jsonwebtoken");
require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const port = process.env.PORT || 5500;

// middleware
app.use(cors());
app.use(express.json());

// custom middleware

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.grteoyu.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// app

// custom middleware
// custom midlw=eware verify token
const verifytoken = (req, res, next) => {
  console.log("inside verifytoken middleware", req.headers.authorization);
  if (!req.headers.authorization) {
    return res.status(401).send({ message: "unauthorised access" });
  }
  const token = req.headers.authorization.split(" ")[1];
  console.log("get token", token);
  jwt.verify(token, process.env.ACCESS_SECRET_TOKEN, (err, decoded) => {
    if (err) {
      return res.status(401).send({ message: "unauthorised access" });
    }
    req.decoded = decoded;
    console.log("from verifytoken decoded", decoded);
    next();
  });
};

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    //   users collection
    const userCollection = client.db("AwsScholars").collection("users");
    const reviewCollection = client.db("AwsScholars").collection("reviews");
    const paymentCollection = client.db("AwsScholars").collection("payments");
    const appliedScholarshipCollection = client
      .db("AwsScholars")
      .collection("appliedScholarships");

    const scholarshipCollection = client
      .db("AwsScholars")
      .collection("scholarships");

    // custom middleware verifyAdmin
    // verify admin after checking verfytoken
    const verifyadmin = async (req, res, next) => {
      const email = req.decoded.email;
      console.log("verify admin ", email);
      const query = { email: email };
      const user = await userCollection.findOne(query);
      const isAdmin = user?.role === "admin";
      console.log("inside verifyadmin", isAdmin);
      if (!isAdmin) {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };
    // verify moderator after checking verfytoken
    const verifyModeratorAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      console.log("verify moderator ", email);
      const query = { email: email };
      const user = await userCollection.findOne(query);
      const isModeratorAdmin =
        user?.role === "moderator" || user?.role === "admin";
      console.log("inside verifyModeratorAdmin", isModeratorAdmin);
      if (!isModeratorAdmin) {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    // jwt related api

    app.post("/jwt", async (req, res) => {
      const userinfo = req.body;
      console.log("inside jwt", userinfo);
      const token = await jwt.sign(userinfo, process.env.ACCESS_SECRET_TOKEN, {
        expiresIn: "4h",
      });
      // console.log(token);

      res.send({ token });
    });

    //   USERS RELATED API
    //   post users in db
    app.post("/users", async (req, res) => {
      // INSERT EMAIL IF USER DOESNOT EXIST
      // you can do this in many ways
      // 1. unique email in database 2. upsert 3. simple we will follow the num 3 way in this case

      const user = req.body;
      const query = {
        email: user.email,
      };
      const isUserExist = await userCollection.findOne(query);
      if (isUserExist) {
        return res.send({
          message: "user already exist",

          insertedId: null,
        });
      }
      const result = await userCollection.insertOne(user);
      res.send(result);
    });
    // make admin/moderator role
    app.put("/users/admin/:id", verifytoken, verifyadmin, async (req, res) => {
      const id = req.params.id;
      const { userRole } = req?.body;
      const filter = { _id: new ObjectId(id) };
      const options = {
        upsert: true,
      };
      const updatedDoc = {
        $set: {
          role: userRole,
        },
      };

      const result = await userCollection.updateOne(
        filter,
        updatedDoc,
        options
      );
      res.send(result);
    });
    app.delete("/users/:id", verifytoken, verifyadmin, async (req, res) => {
      const id = req.params?.id;
      // console.log(filterdata);

      let query = {
        _id: new ObjectId(id),
      };

      // console.log(query);
      const result = await userCollection.deleteOne(query);
      res.send(result);
    });
    app.get("/users", verifytoken, verifyadmin, async (req, res) => {
      const filterdata = req.query?.role;
      console.log(filterdata);

      let query;
      if (filterdata) {
        query = {
          role: filterdata,
        };
      }
      console.log(query);
      const result = await userCollection.find(query).toArray();
      res.send(result);
    });

    // get single user data from db
    app.get("/users/:email", verifytoken, async (req, res) => {
      const email = req.params?.email;

      query = {
        email: email,
      };

      const result = await userCollection.findOne(query);
      res.send(result);
    });

    // scholarship related api
    app.get("/top-sholarship", async (req, res) => {
      const result = await scholarshipCollection
        .aggregate([
          // Convert ApplicationDeadline to Date format
          {
            $addFields: {
              postDateISO: {
                $toDate: "$postDate",
              },
            },
          },

          // Sort by both applicationFees and applicationDeadline
          { $sort: { postDateISO: -1, applicationFees: 1 } },
          { $limit: 6 },
        ])
        .toArray();
      res.send(result);
    });
    // GET ALL SCHOLARSHIP FOR ALL SCHOALRSHIP PAHGE
    app.get("/allsholarship", async (req, res) => {
      const searchQuery = req.query?.search;
      const page = parseInt(req.query?.page) - 1;
      const size = parseInt(req.query?.size);
      // console.log("from all scholarship", searchQuery, page, size);
      const query = {};

      if (searchQuery) {
        query.$or = [
          { scholarshipName: { $regex: searchQuery, $options: "i" } },
          { universityName: { $regex: searchQuery, $options: "i" } },
          { degree: { $regex: searchQuery, $options: "i" } },
        ];
      }
      let result;
      if (page || size) {
        result = await scholarshipCollection
          .find(query)
          .skip(page * size)
          .limit(size)
          .toArray();
      } else {
        result = await scholarshipCollection.find(query).toArray();
      }

      res.send(result);
    });

    // get count for pagination
    app.get("/scholarship-count", async (req, res) => {
      const searchQuery = req.query?.search;
      const query = {};
      if (searchQuery) {
        query.$or = [
          { scholarshipName: { $regex: searchQuery, $options: "i" } },
          { universityName: { $regex: searchQuery, $options: "i" } },
          { degree: { $regex: searchQuery, $options: "i" } },
        ];
      }
      const count = await scholarshipCollection.countDocuments(query);
      res.send({ count });
    });
    // get single scholarship data v
    app.post(
      "/scholarships",
      verifytoken,
      verifyModeratorAdmin,
      async (req, res) => {
        const scholarship = req?.body;

        const result = await scholarshipCollection.insertOne(scholarship);
        res.send(result);
      }
    );
    // get single scholarship data v
    app.get("/scholarships/:id", verifytoken, async (req, res) => {
      const id = req.params.id;
      const query = {
        _id: new ObjectId(id),
      };
      console.log(query, id);
      const result = await scholarshipCollection.findOne(query);
      res.send(result);
    });
    // update scholarshpi
    app.patch(
      "/scholarships/:id",
      verifytoken,
      verifyModeratorAdmin,
      async (req, res) => {
        const id = req.params?.id;
        const scholarship = req?.body;
        const filter = {
          _id: new ObjectId(id),
        };
        const updatedData = {
          $set: {
            scholarshipName: scholarship?.scholarshipName,
            universityName: scholarship?.universityName,
            imageUrl: scholarship?.imageUrl,
            universityCountry: scholarship?.universityCountry,
            universityCity: scholarship?.universityCity,
            universityWorldRank: scholarship?.universityWorldRank,
            subjectCategory: scholarship?.subjectCategory,
            scholarshipCategory: scholarship?.scholarshipCategory,
            degree: scholarship?.degree,
            tuitionFees: scholarship?.tuitionFees,
            applicationFees: scholarship?.applicationFees,
            serviceCharge: scholarship?.serviceCharge,
            applicationDeadline: scholarship?.applicationDeadline,
            ScholarshipDetailsField: scholarship?.ScholarshipDetailsField,
            stipend: scholarship?.stipend,
          },
        };

        const result = await scholarshipCollection.updateOne(
          filter,
          updatedData
        );
        res.send(result);
      }
    );
    // get single scholarship data v
    app.delete(
      "/scholarships/:id",
      verifytoken,
      verifyModeratorAdmin,
      async (req, res) => {
        const id = req.params.id;
        const query = {
          _id: new ObjectId(id),
        };
        console.log(query, id);
        const result = await scholarshipCollection.deleteOne(query);
        res.send(result);
      }
    );

    // review related api

    // insert review from add review in user dashboard
    app.post("/reviews", verifytoken, async (req, res) => {
      const review = req?.body;

      const result = await reviewCollection.insertOne(review);
      res.send(result);
    });
    // GEt all  review from reviewCollection in moderator admin dashboard
    app.get("/reviews", verifytoken, verifyModeratorAdmin, async (req, res) => {
      const result = await reviewCollection.find().toArray();
      res.send(result);
    });
    // get top 9
    app.get("/top-reviews", async (req, res) => {
      const result = await reviewCollection
        .aggregate([
          { $sort: { ratingPoint: -1 } }, // Sort by ratingPoint in descending order
          { $limit: 9 }, // Limit to top 9 reviews])
        ])
        .toArray();
      res.send(result);
    });
    // get reviews for specific id
    app.get("/reviews/:id", verifytoken, async (req, res) => {
      const id = req.params?.id;
      const query = {
        scholarshipId: id,
      };
      const scholarshipReview = await reviewCollection.find(query).toArray();
      res.send(scholarshipReview);
    });
    // get applied data based on id
    app.patch("/reviews/:id", verifytoken, async (req, res) => {
      const id = req.params?.id;
      const updatedData = req?.body;

      const filter = { _id: new ObjectId(id) };
      const updatedReview = {
        $set: {
          reviewComment: updatedData?.reviewComment,
          ratingPoint: updatedData?.ratingPoint,
        },
      };
      console.log("inside single edit update ", id, filter);
      const result = await reviewCollection.updateOne(filter, updatedReview);
      res.send(result);
    });
    // delete reviews for specific id
    app.delete("/reviews/:id", verifytoken, async (req, res) => {
      const id = req.params?.id;
      const query = {
        _id: new ObjectId(id),
      };
      const scholarshipReview = await reviewCollection.deleteOne(query);
      res.send(scholarshipReview);
    });
    // get reviews for user email for my reviews sections
    app.get("/myreviews/:email", verifytoken, async (req, res) => {
      const email = req.params?.email;
      console.log("inside my reviews", email);
      const query = {
        userEmail: email,
      };
      const myReview = await reviewCollection.find(query).toArray();
      res.send(myReview);
    });
    // GET AVARAGE RATING FROM REVIEW BASED ON SCHOLARSHIP ID
    app.get("/average-rating/:scholarshipID", async (req, res) => {
      const scholarshipID = req.params?.scholarshipID;

      // Aggregation to calculate the average rating for a specific scholarshipID
      const result = await reviewCollection
        .aggregate([
          {
            $match: {
              scholarshipId: scholarshipID,
            },
          },
          { $group: { _id: null, averageRating: { $avg: "$ratingPoint" } } },
        ])
        .toArray();

      const averageRating = result.length ? result[0]?.averageRating : 0;
      console.log("in avg rating", averageRating);
      res.send({ averageRating });
    });
    // PAYMENT RELATED APIS
    // PAYMENT INTENT
    app.post("/create-payment-intent", async (req, res) => {
      const { price } = req.body;
      console.log("inside paymentIntent", req.body);
      const amount = parseInt(price * 100);
      console.log(amount, "amount inside the intent");

      // Create a PaymentIntent with the order amount and currency
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"],
      });
      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

    // save payment history
    app.post("/payments", async (req, res) => {
      const payment = req.body;
      console.log(payment);
      const paymentResult = await paymentCollection.insertOne(payment);

      res.send(paymentResult);
    });

    // get all applied application based on specific user id
    app.get("/appliedScholarship/:email", verifytoken, async (req, res) => {
      const email = req.params?.email;
      const query = {
        userEmail: email,
      };
      const result = await appliedScholarshipCollection.find(query).toArray();
      res.send(result);
    });
    // get all applied application
    app.get(
      "/appliedScholarship",
      verifytoken,
      verifyModeratorAdmin,
      async (req, res) => {
        const result = await appliedScholarshipCollection.find().toArray();
        res.send(result);
      }
    );

    // get applied data based on id
    app.get("/appliedapplication/:id", verifytoken, async (req, res) => {
      const id = req.params?.id;

      const query = { scholarshipId: id };
      console.log("inside single applied ", id, query);
      const result = await appliedScholarshipCollection.findOne(query);

      res.send(result);
    });
    // get applied data based on id
    app.patch("/appliedapplication/:id", verifytoken, async (req, res) => {
      const id = req.params?.id;
      const updatedData = req?.body;

      const filter = { _id: new ObjectId(id) };
      const updatedAppliedApplications = {
        $set: {
          applicantPhone: updatedData?.applicantPhone,
          imageUrl: updatedData?.imageUrl,
          applicantAddress: updatedData?.applicantAddress,
          applicantGender: updatedData?.applicantGender,
          applicantAspiredDegree: updatedData?.applicantAspiredDegree,
          applicantSscResult: updatedData?.applicantSscResult,
          applicantHscResult: updatedData?.applicantHscResult,
          applicantStudyGap: updatedData?.applicantStudyGap,
          universityName: updatedData?.universityName,
          scholarshipCategory: updatedData?.scholarshipCategory,
          subjectCategory: updatedData?.subjectCategory,
        },
      };
      console.log("inside single applied ", id, filter);
      const result = await appliedScholarshipCollection.updateOne(
        filter,
        updatedAppliedApplications
      );
      res.send(result);
    });
    // delete applied scholarship
    app.delete("/appliedScholarship/:id", verifytoken, async (req, res) => {
      const id = req.params?.id;
      const query = {
        _id: new ObjectId(id),
      };
      const result = await appliedScholarshipCollection.deleteOne(query);
      res.send(result);
    });
    // dlete applied
    // save applicant details as appliedScholarships
    // to do queryn with userEmail
    app.post("/appliedScholarship", async (req, res) => {
      const applieSchoalrshipData = req.body;
      const query = {
        userEmail: applieSchoalrshipData.userEmail,
        scholarshipId: applieSchoalrshipData.scholarshipId,
      };
      const isExist = await appliedScholarshipCollection.findOne(query);
      if (isExist) {
        return res
          .status(403)
          .send({ message: "Applicant already applied for this schoalrship" });
      }
      console.log(applieSchoalrshipData);
      const result = await appliedScholarshipCollection.insertOne(
        applieSchoalrshipData
      );

      res.send(result);
    });
    // cencel application
    app.patch(
      "/appliedScholarship/:id",
      verifytoken,
      verifyModeratorAdmin,
      async (req, res) => {
        const id = req.params?.id;
        const updatedData = req?.body;
        // console.log("inside feedback", id, updatedData);

        const filter = { _id: new ObjectId(id) };
        const updatedFeedback = {
          $set: {
            applicationStatus: updatedData?.applicationStatus,
          },
        };
        const options = {
          upsert: true,
        };
        console.log("inside single edit update ", id, filter);
        const result = await appliedScholarshipCollection.updateOne(
          filter,
          updatedFeedback,
          options
        );
        res.send(result);
      }
    );
    // give feed back
    app.patch(
      "/appliedScholarship/:id",
      verifytoken,
      verifyModeratorAdmin,
      async (req, res) => {
        const id = req.params?.id;
        const updatedData = req?.body;
        console.log("inside feedback", id, updatedData);

        const filter = { _id: new ObjectId(id) };
        const updatedFeedback = {
          $set: {
            feedback: updatedData?.feedback,
          },
        };
        const options = {
          upsert: true,
        };
        console.log("inside single edit update ", id, filter);
        const result = await appliedScholarshipCollection.updateOne(
          filter,
          updatedFeedback
        );
        res.send(result);
      }
    );
    // imagekit image Upload getsignature
    app.get("/get-signature", async (req, res) => {
      var imagekit = new ImageKit({
        publicKey: process.env.IMAGEKIT_PK,
        privateKey: process.env.IMAGEKIT_SK,
        urlEndpoint: "https://ik.imagekit.io/sayidImage34/",
      });
      const authenticationParameters =
        await imagekit.getAuthenticationParameters();
      console.log(authenticationParameters);
      res.send(authenticationParameters);
    });

    // admin related apis
    // check if user is admin

    // check admin
    app.get(
      "/users/admin/:email",
      verifytoken,

      async (req, res) => {
        const email = req.params.email;
        console.log("inside useAdmin route", req.decoded.email);
        console.log("inside useAdmin params", email);

        if (email !== req.decoded.email) {
          return res.status(401).send({
            message: "Unauthorize access",
          });
        }
        const query = {
          email: email,
        };
        console.log(query);
        const user = await userCollection.findOne(query);
        console.log("inside useAdmin route", user);
        let admin = false;
        if (user) {
          admin = user?.role === "admin";
        }
        res.send({ admin });
      }
    );

    // check moderator
    app.get(
      "/users/moderator/:email",
      verifytoken,

      async (req, res) => {
        const email = req.params.email;
        console.log("inside moderator route", req.decoded.email);
        console.log("inside moderator params", email);

        if (email !== req.decoded.email) {
          return res.status(401).send({
            message: "Unauthorize access",
          });
        }
        const query = {
          email: email,
        };
        console.log(query);
        const user = await userCollection.findOne(query);
        console.log("inside check moderator route", user);
        let moderator = false;
        if (user) {
          moderator = user?.role === "moderator";
        }
        console.log(moderator);
        res.send({ moderator });
      }
    );

    app.get("/", (req, res) => {
      res.send("AwsScholars are running");
    });
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

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
