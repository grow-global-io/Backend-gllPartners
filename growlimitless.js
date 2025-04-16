const express = require('express');
const app = express();
const port = process.env.PORT || 8000;
const cors = require('cors');
const multer = require('multer');
const AWS = require("aws-sdk");
const fs = require("fs");
const path = require("path");
const { PrismaClient } = require('@prisma/client');
const { authaRouter } = require('./routes/auth');
require('dotenv').config();

// Initialize Prisma client
const prismaClient = global.prisma || new PrismaClient();
if (process.env.NODE_ENV !== 'production') {
    global.prisma = prismaClient;
}

// More detailed CORS setup
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Middleware setup
app.use(express.json());
app.use(authaRouter);

// For debugging requests
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

// Create uploads directory if it doesn't exist
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
    console.log(`Created uploads directory at: ${uploadDir}`);
}

// AWS S3 setup - use environment variables for credentials
try {
    AWS.config.update({
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        region: process.env.AWS_REGION || 'eu-north-1'
    });
    console.log(`AWS configured with region: ${process.env.AWS_REGION || 'eu-north-1'}`);
    console.log(`Using S3 bucket: ${process.env.AWS_S3_BUCKET || 'userpdfbucket-gll'}`);
} catch (err) {
    console.error('AWS configuration error:', err);
}

const s3 = new AWS.S3();

// Multer setup
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, `${uniqueSuffix}-${file.originalname}`);
    }
});

const upload = multer({ 
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => {
        // You can add file type validation here if needed
        console.log(`Received file: ${file.originalname}, type: ${file.mimetype}`);
        cb(null, true);
    }
});

// Routes
app.get("/", (req, res) => {
    res.json({ status: "Server is running", timestamp: new Date().toISOString() });
});

app.post('/upload', (req, res) => {
    console.log('Upload endpoint hit');
    
    // Use multer middleware here
    upload.single('file')(req, res, async function(err) {
        if (err) {
            console.error('Multer error:', err);
            return res.status(400).json({ error: err.message });
        }
        
        try {
            const file = req.file;
            const fileType = req.body?.type || "unknown";
            
            console.log('File received:', file ? file.originalname : 'No file');
            console.log('File type:', fileType);
            
            if (!file) {
                return res.status(400).json({ error: "No file uploaded" });
            }
            
            console.log('Creating read stream from:', file.path);
            const fileStream = fs.createReadStream(file.path);
            
            const s3Params = {
                Bucket: process.env.AWS_S3_BUCKET || 'userpdfbucket-gll',
                Key: `upload/${Date.now()}_${file.originalname}`,
                Body: fileStream,
                ContentType: file.mimetype
            };
            
            console.log('Uploading to S3...');
            const data = await s3.upload(s3Params).promise();
            console.log("S3 upload successful:", data.Location);
            console.log("S3 Response Details:", {
                Bucket: data.Bucket,
                Key: data.Key,
                ETag: data.ETag,
                Location: data.Location
            });
            
            try {
                // Save to DB using Prisma
                console.log('Saving to database...');
                const savedFile = await prismaClient.file.create({
                    data: {
                        type: fileType,
                        url: data.Location
                    }
                });
                console.log("File record created in database:", savedFile.id);
                
                res.status(200).json({
                    message: 'File uploaded and saved',
                    field: fileType,
                    url: data.Location
                });
            } catch (dbError) {
                console.error("Database save failed:", dbError);
                res.status(500).json({ 
                    error: "File uploaded to S3 but database record creation failed",
                    details: dbError.message,
                    url: data.Location
                });
            }
            
            // Clean up local file
            fs.unlink(file.path, (unlinkErr) => {
                if (unlinkErr) console.error("Failed to clean up local file:", unlinkErr);
            });
        } catch (err) {
            console.error("Upload failed:", err);
            res.status(500).json({ 
                error: "File upload failed", 
                details: err.message,
                stack: err.stack
            });
            
            // If the file exists locally but upload failed, clean it up
            if (req.file && fs.existsSync(req.file.path)) {
                fs.unlink(req.file.path, () => {});
            }
        }
    });
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});

