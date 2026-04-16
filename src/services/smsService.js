
/**
 * Servicio SMS via AWS SNS
 *
 * Variables de entorno requeridas:
 * AWS_REGION (o AWS_SNS_REGION): región de AWS SNS (ej: 'us-east-1')
 * AWS_ACCESS_KEY_ID: access key de IAM con permisos SNS
 * AWS_SECRET_ACCESS_KEY: secret key de IAM
 *
 * Si no están configuradas, el servicio SMS no envía mensajes (modo desarrollo).
 */

const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');

const region = process.env.AWS_REGION || process.env.AWS_SNS_REGION;
const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

let snsClient = null;

if (region && accessKeyId && secretAccessKey) {
  snsClient = new SNSClient({
    region,
    credentials: { accessKeyId, secretAccessKey }
  });
} else {
  console.warn('[smsService] AWS SNS no configurado. Los SMS no serán enviados. Configurá AWS_REGION, AWS_ACCESS_KEY_ID y AWS_SECRET_ACCESS_KEY para habilitar el envío.');
}

/**
 * Envía un SMS transaccional via AWS SNS.
 * @param {string} phone - Número de teléfono en formato internacional (ej: +5491155551234)
 * @param {string} message - Texto del mensaje
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function sendSMS(phone, message) {
  if (!snsClient) {
    return { success: false, error: 'SMS service not configured' };
  }

  try {
    const command = new PublishCommand({
      PhoneNumber: phone,
      Message: message,
      MessageAttributes: {
        'AWS.SNS.SMS.SMSType': {
          DataType: 'String',
          StringValue: 'Transactional'
        }
      }
    });

    await snsClient.send(command);
    return { success: true };
  } catch (error) {
    // Avoid logging user-controlled phone number in format strings
    console.error('[smsService] Error enviando SMS:', error.message);
    return { success: false, error: error.message };
  }
}

module.exports = { sendSMS };
