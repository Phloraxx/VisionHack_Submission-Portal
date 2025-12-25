// Email service for sending credentials to users
import nodemailer from 'nodemailer';

export interface EmailParams {
  to: string;
  name: string;
  email: string;
  password: string;
  role: 'campus_lead' | 'team_lead';
  institutionName?: string;
}

// Create transporter for sending emails via Gmail SMTP
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false, // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Send a single email
export async function sendEmail(params: EmailParams): Promise<boolean> {
  try {
    const subject = params.role === 'campus_lead' 
      ? '🎯 Welcome to VisionHack - Campus Lead Credentials'
      : '🚀 You\'re Shortlisted - Team Lead Credentials';
    
    const htmlContent = params.role === 'campus_lead'
      ? getCampusLeadEmailTemplate(params)
      : getTeamLeadEmailTemplate(params);

    // Send email using nodemailer
    await transporter.sendMail({
      from: `"VisionHack Team" <${process.env.SMTP_USER}>`,
      to: params.to,
      subject: subject,
      html: htmlContent,
    });

    console.log(`✓ Email sent successfully to ${params.email}`);
    return true;
  } catch (error: any) {
    console.error(`✗ Failed to send email to ${params.email}:`, error.message);
    return false;
  }
}

// Send emails in bulk
export async function bulkSendEmails(emailParamsList: EmailParams[]): Promise<number> {
  let successCount = 0;
  
  for (const params of emailParamsList) {
    const success = await sendEmail(params);
    if (success) successCount++;
    
    // Add a small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  console.log(`Sent ${successCount}/${emailParamsList.length} emails successfully`);
  return successCount;
}

// Email template for campus leads
function getCampusLeadEmailTemplate(params: EmailParams): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
    .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
    .credentials { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #667eea; }
    .credential-item { margin: 10px 0; }
    .credential-label { font-weight: bold; color: #667eea; }
    .credential-value { font-family: 'Courier New', monospace; background: #f0f0f0; padding: 8px 12px; border-radius: 4px; display: inline-block; margin-top: 5px; }
    .button { background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block; margin: 20px 0; }
    .footer { text-align: center; color: #666; font-size: 12px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🎯 Welcome to VisionHack!</h1>
    </div>
    <div class="content">
      <p>Dear <strong>${params.name}</strong>,</p>
      
      <p>Congratulations! You have been registered as the <strong>Campus Lead</strong> for <strong>${params.institutionName || 'your institution'}</strong> at VisionHack 2025.</p>
      
      <p>As a Campus Lead, you will be responsible for:</p>
      <ul>
        <li>Managing team registrations from your institution</li>
        <li>Shortlisting and inviting 5 team leads after the selection process</li>
        <li>Coordinating with your institution's participants</li>
      </ul>
      
      <div class="credentials">
        <h3>Your Login Credentials</h3>
        <div class="credential-item">
          <div class="credential-label">Email:</div>
          <div class="credential-value">${params.email}</div>
        </div>
        <div class="credential-item">
          <div class="credential-label">Temporary Password:</div>
          <div class="credential-value">${params.password}</div>
        </div>
      </div>
      
      <p><strong>⚠️ Important:</strong> Please change your password after your first login for security purposes.</p>
      
      <a href="${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/auth/login" class="button">Login to Dashboard</a>
      
      <p>If you have any questions or need assistance, please don't hesitate to reach out to our support team.</p>
      
      <p>Best regards,<br><strong>VisionHack Team</strong></p>
    </div>
    <div class="footer">
      <p>This is an automated email. Please do not reply to this message.</p>
      <p>&copy; 2025 VisionHack. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
  `.trim();
}

// Email template for team leads
function getTeamLeadEmailTemplate(params: EmailParams): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
    .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
    .credentials { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #f5576c; }
    .credential-item { margin: 10px 0; }
    .credential-label { font-weight: bold; color: #f5576c; }
    .credential-value { font-family: 'Courier New', monospace; background: #f0f0f0; padding: 8px 12px; border-radius: 4px; display: inline-block; margin-top: 5px; }
    .button { background: #f5576c; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block; margin: 20px 0; }
    .footer { text-align: center; color: #666; font-size: 12px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🚀 You're Shortlisted!</h1>
    </div>
    <div class="content">
      <p>Dear <strong>${params.name}</strong>,</p>
      
      <p>Exciting news! Your team has been shortlisted by <strong>${params.institutionName || 'your institution'}</strong> to participate in VisionHack 2025!</p>
      
      <p>As a Team Lead, you will be able to:</p>
      <ul>
        <li>Register your team details and members</li>
        <li>Submit your project for the hackathon</li>
        <li>Track your team's progress throughout the event</li>
      </ul>
      
      <div class="credentials">
        <h3>Your Login Credentials</h3>
        <div class="credential-item">
          <div class="credential-label">Email:</div>
          <div class="credential-value">${params.email}</div>
        </div>
        <div class="credential-item">
          <div class="credential-label">Temporary Password:</div>
          <div class="credential-value">${params.password}</div>
        </div>
      </div>
      
      <p><strong>⚠️ Important:</strong> Please change your password after your first login for security purposes.</p>
      
      <a href="${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/auth/login" class="button">Login to Dashboard</a>
      
      <p>We're excited to see what your team will create! Good luck!</p>
      
      <p>Best regards,<br><strong>VisionHack Team</strong></p>
    </div>
    <div class="footer">
      <p>This is an automated email. Please do not reply to this message.</p>
      <p>&copy; 2025 VisionHack. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
  `.trim();
}