const AWS = require('aws-sdk');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Initialize AWS S3
console.log('Testing AWS S3 connectivity...');
console.log('AWS Access Key ID:', process.env.AWS_ACCESS_KEY_ID ? '✓ Found' : '✗ Missing');
console.log('AWS Secret Access Key:', process.env.AWS_SECRET_ACCESS_KEY ? '✓ Found' : '✗ Missing');
console.log('AWS Region:', process.env.AWS_REGION || 'eu-north-1');
console.log('AWS S3 Bucket:', process.env.AWS_S3_BUCKET || 'userpdfbucket-gll');

// Configure AWS
AWS.config.update({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION || 'eu-north-1'
});

const s3 = new AWS.S3();

async function testS3Connection() {
    // Define the test file path
    const testFilePath = path.join(__dirname, 'test-upload.txt');
    
    try {
        // Create a test file
        console.log('\nCreating test file...');
        fs.writeFileSync(testFilePath, 'This is a test file for S3 upload');
        
        // Test file upload
        console.log('Testing direct file upload to S3...');
        
        // Create read stream AFTER the file is confirmed to exist
        const fileStream = fs.createReadStream(testFilePath);
        
        // Get bucket name from environment variable
        const bucketName = process.env.AWS_S3_BUCKET || 'userpdfbucket-gll';
        console.log(`Using bucket: ${bucketName}`);
        
        const uploadParams = {
            Bucket: bucketName,
            Key: `upload/test-upload-${Date.now()}.txt`,
            Body: fileStream,
            ContentType: 'text/plain'
        };
        
        console.log('Uploading to S3...');
        const uploadResult = await s3.upload(uploadParams).promise();
        console.log('✓ File upload successful!');
        console.log('File URL:', uploadResult.Location);
        
        // Clean up test file
        fs.unlinkSync(testFilePath);
        console.log('Test file cleaned up locally');
        console.log('\nS3 upload test passed successfully!');
        
    } catch (error) {
        console.error('❌ S3 test failed:', error.message);
        console.error('Full error:', error);
        
        if (error.code) {
            console.error('Error code:', error.code);
        }
        
        // Provide troubleshooting advice
        if (error.code === 'CredentialsError' || error.code === 'InvalidAccessKeyId') {
            console.error('\nTroubleshooting:');
            console.error('- Check your AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in .env file');
            console.error('- Verify that the credentials are active in your AWS account');
        } else if (error.code === 'NoSuchBucket') {
            console.error('\nTroubleshooting:');
            console.error(`- Bucket '${process.env.AWS_S3_BUCKET || 'userpdfbucket-gll'}' does not exist`);
            console.error('- Create the bucket or update AWS_S3_BUCKET in .env file');
        } else if (error.code === 'AccessDenied') {
            console.error('\nTroubleshooting Access Denied:');
            console.error('- Your IAM user/role needs s3:PutObject permission for this bucket');
            console.error('- Check your IAM policies in AWS console');
            console.error('- The bucket might have a bucket policy that denies your access');
        } else if (error.code === 'NetworkingError') {
            console.error('\nTroubleshooting:');
            console.error('- Check your internet connection');
            console.error('- Verify that AWS services are available in your region');
        }
    } finally {
        // Always attempt to clean up the test file
        try {
            if (fs.existsSync(testFilePath)) {
                fs.unlinkSync(testFilePath);
                console.log('Test file cleaned up');
            }
        } catch (e) {
            console.error('Could not clean up test file:', e.message);
        }
    }
}

testS3Connection(); 