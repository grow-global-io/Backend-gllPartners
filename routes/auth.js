const express = require('express');
const { PrismaClient } = require('@prisma/client');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const AWS = require('aws-sdk');
const prisma = new PrismaClient();
const authaRouter = express.Router();
// const upload = multer({ dest: 'uploads/' });

// Configure AWS - use environment variables from main app
const s3 = new AWS.S3({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION || 'eu-north-1'
});

// Set up multer for file uploads
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, `${uniqueSuffix}-${file.originalname}`);
    }
});

const upload = multer({
    dest: 'uploads/',
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => {
        // You can add file type validation here if needed
        cb(null, true);
    }
});

// Registration route with file upload
authaRouter.post("/register", upload.single('certificate'), async (req, res) => {
    try {
        console.log('Register endpoint hit');
        console.log('Request body:', req.body);
        
        // Check if we received a file
        if (!req.file) {
            return res.status(400).json({ error: "Certificate file is required" });
        }
        
        console.log('File received:', req.file.originalname);
        
        // Extract user data from request
        const {
            name,
            designation,
            email,
            password,
            phone,
            accountName,
            accountNumber,
            ifscCode,
            gstNumber,
            companyName,
            companyAddress,
            companyType,
            international,
            terms,
            userId,
            type // 'msmeCertificate' or 'oemCertificate'
        } = req.body;
        
        // Upload the file to S3
        const fileStream = fs.createReadStream(req.file.path);
        const s3Params = {
            Bucket: process.env.AWS_S3_BUCKET || 'userpdfbucket-gll',
            Key: `certificates/${Date.now()}_${req.file.originalname}`,
            Body: fileStream,
            ContentType: req.file.mimetype
        };
        
        console.log('Uploading certificate to S3...');
        const uploadResult = await s3.upload(s3Params).promise();
        const s3Url = uploadResult.Location;
        console.log('File uploaded successfully:', s3Url);
        
        // Convert string values to appropriate types
        const boolInternational = international === 'true' || international === true;
        const boolTerms = terms === 'true' || terms === true;
        const userIdValue = userId ? parseInt(userId, 10) : undefined;
        
        // Create user in database
        console.log('Creating user in database...');
        const newUser = await prisma.user.create({
            data: {
                name,
                designation,
                email,
                password,
                phone,
                accountName,
                accountNumber,
                ifscCode,
                gstNumber,
                companyAddress,
                companyType,
                international: boolInternational,
                terms: boolTerms,
                url: s3Url,
                type: type || 'certificate', // Default to 'certificate' if not specified
                ...(userIdValue && { userId: userIdValue }) // Only include if userId is provided
            }
        });
        
        console.log('User created successfully:', newUser.id);
        
        // Clean up the temporary file
        fs.unlink(req.file.path, (err) => {
            if (err) console.error('Failed to delete temporary file:', err);
        });
        
        res.status(201).json({
            success: true,
            user: newUser,
            fileUrl: s3Url
        });
    } catch (error) {
        console.error("Error creating user:", error);
        
        // Clean up the temporary file if it exists
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlink(req.file.path, () => {});
        }
        
        res.status(500).json({ 
            error: "User registration failed", 
            details: error.message 
        });
    }
});

module.exports = { authaRouter };
