const express = require('express');
const router = express.Router();
const asyncHandler = require('../utils/asyncHandler');
const logger = require('../utils/logger');
const { authenticate } = require('../middlewares/auth');

router.post('/presigned-url', authenticate, asyncHandler(async (req, res) => {
  if (!process.env.S3_BUCKET) {
    return res.status(501).json({ error: 'Upload a S3 no configurado. Usar envío por base64.' });
  }
  const { filename, contentType } = req.body;
  if (!filename || !contentType) {
    return res.status(400).json({ error: 'filename y contentType requeridos' });
  }
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (!allowedTypes.includes(contentType)) {
    return res.status(400).json({ error: 'Tipo de archivo no permitido' });
  }
  const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
  const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
  const key = `chat-images/${req.user.userId}/${Date.now()}-${filename}`;
  const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
  const command = new PutObjectCommand({
    Bucket: process.env.S3_BUCKET,
    Key: key,
    ContentType: contentType
  });
  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });
  const publicUrl = `https://${process.env.S3_BUCKET}.s3.amazonaws.com/${key}`;
  res.json({ uploadUrl, publicUrl });
}));

module.exports = router;
