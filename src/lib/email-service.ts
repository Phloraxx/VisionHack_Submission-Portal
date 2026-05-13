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
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #2c3e50; background-color: #f5f7fa; }
    .email-wrapper { width: 100%; padding: 40px 20px; background-color: #f5f7fa; }
    .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.07); }
    .header { background: #3b82f6; color: white; padding: 40px 30px; text-align: center; }
    .header h1 { font-size: 28px; font-weight: 600; margin: 0; }
    .header .emoji { font-size: 48px; margin-bottom: 15px; display: block; }
    .content { padding: 40px 30px; background: white; }
    .greeting { font-size: 18px; color: #1e293b; margin-bottom: 20px; }
    .greeting strong { color: #3b82f6; }
    .intro-text { font-size: 15px; color: #475569; margin-bottom: 25px; line-height: 1.7; }
    .responsibilities { background: #f8fafc; border-radius: 8px; padding: 20px; margin: 25px 0; }
    .responsibilities h3 { font-size: 16px; color: #1e293b; margin-bottom: 12px; }
    .responsibilities ul { list-style: none; padding-left: 0; }
    .responsibilities li { padding: 8px 0; padding-left: 24px; position: relative; color: #475569; font-size: 14px; }
    .responsibilities li:before { content: "✓"; position: absolute; left: 0; color: #3b82f6; font-weight: bold; }
    .credentials { background: #f8fafc; border-radius: 8px; padding: 25px; margin: 30px 0; border: 1px solid #e2e8f0; }
    .credentials h3 { font-size: 16px; color: #1e293b; margin-bottom: 20px; text-align: center; }
    .credential-item { margin: 15px 0; }
    .credential-label { font-size: 13px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
    .credential-value { font-family: 'Courier New', monospace; background: white; color: #1e293b; padding: 12px 16px; border-radius: 6px; font-size: 14px; border: 1px solid #e2e8f0; word-break: break-all; }
    .warning { background: #fef3c7; border-left: 3px solid #f59e0b; padding: 15px; border-radius: 6px; margin: 25px 0; }
    .warning p { color: #92400e; font-size: 14px; margin: 0; }
    .warning strong { color: #78350f; }
    .button-container { text-align: center; margin: 30px 0; }
    .button { background: #3b82f6; color: white; padding: 14px 40px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: 600; font-size: 15px; transition: background 0.3s; }
    .button:hover { background: #2563eb; }
    .footer-text { font-size: 14px; color: #475569; margin-top: 30px; line-height: 1.7; }
    .signature { margin-top: 25px; padding-top: 20px; border-top: 1px solid #e2e8f0; }
    .signature p { margin: 4px 0; color: #64748b; font-size: 14px; }
    .footer { background: #f8fafc; padding: 25px 30px; text-align: center; border-top: 1px solid #e2e8f0; }
    .footer p { color: #94a3b8; font-size: 12px; margin: 6px 0; }
  </style>
</head>
<body>
  <div class="email-wrapper">
    <div class="container">
      <div class="header">
        <span class="emoji">🎯</span>
        <h1>Welcome to VisionHack!</h1>
      </div>
      
      <div class="content">
        <p class="greeting">Dear <strong>${params.name}</strong>,</p>
        
        <p class="intro-text">Congratulations! You have been registered as the <strong>Campus Lead</strong> for <strong>${params.institutionName || 'your institution'}</strong> at VisionHack 2025.</p>
        
        <div class="responsibilities">
          <h3>Your Responsibilities</h3>
          <ul>
            <li>Managing team registrations from your institution</li>
            <li>Shortlisting and inviting 5 team leads after the selection process</li>
            <li>Coordinating with your institution's participants</li>
          </ul>
        </div>
        
        <div class="credentials">
          <h3>🔐 Your Login Credentials</h3>
          <div class="credential-item">
            <div class="credential-label">Email Address</div>
            <div class="credential-value">${params.email}</div>
          </div>
          <div class="credential-item">
            <div class="credential-label">Temporary Password</div>
            <div class="credential-value">${params.password}</div>
          </div>
        </div>
        
        <div class="button-container">
          <a href="https://portal.mulearn.org/auth/login" class="button">Login to Dashboard →</a>
        </div>
        
        <p class="footer-text">If you have any questions or need assistance, please don't hesitate to reach out to our support team.</p>
        
        <div class="signature">
          <p>Best regards,</p>
          <p><strong>VisionHack Team</strong></p>
        </div>
      </div>
      
      <div class="footer">
        <p>This is an automated email. Please do not reply to this message.</p>
        <p>&copy; 2025 VisionHack. All rights reserved.</p>
      </div>
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
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #2c3e50; background-color: #f5f7fa; }
    .email-wrapper { width: 100%; padding: 40px 20px; background-color: #f5f7fa; }
    .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.07); }
    .header { background: #10b981; color: white; padding: 40px 30px; text-align: center; }
    .header h1 { font-size: 28px; font-weight: 600; margin: 0; }
    .header .emoji { font-size: 48px; margin-bottom: 15px; display: block; }
    .content { padding: 40px 30px; background: white; }
    .greeting { font-size: 18px; color: #1e293b; margin-bottom: 20px; }
    .greeting strong { color: #10b981; }
    .intro-text { font-size: 15px; color: #475569; margin-bottom: 25px; line-height: 1.7; }
    .celebration { background: #ecfdf5; border-radius: 8px; padding: 20px; margin: 25px 0; text-align: center; border: 2px solid #d1fae5; }
    .celebration p { color: #065f46; font-size: 16px; font-weight: 500; margin: 0; }
    .capabilities { background: #f8fafc; border-radius: 8px; padding: 20px; margin: 25px 0; }
    .capabilities h3 { font-size: 16px; color: #1e293b; margin-bottom: 12px; }
    .capabilities ul { list-style: none; padding-left: 0; }
    .capabilities li { padding: 8px 0; padding-left: 24px; position: relative; color: #475569; font-size: 14px; }
    .capabilities li:before { content: "✓"; position: absolute; left: 0; color: #10b981; font-weight: bold; }
    .credentials { background: #f8fafc; border-radius: 8px; padding: 25px; margin: 30px 0; border: 1px solid #e2e8f0; }
    .credentials h3 { font-size: 16px; color: #1e293b; margin-bottom: 20px; text-align: center; }
    .credential-item { margin: 15px 0; }
    .credential-label { font-size: 13px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
    .credential-value { font-family: 'Courier New', monospace; background: white; color: #1e293b; padding: 12px 16px; border-radius: 6px; font-size: 14px; border: 1px solid #e2e8f0; word-break: break-all; }
    .warning { background: #fef3c7; border-left: 3px solid #f59e0b; padding: 15px; border-radius: 6px; margin: 25px 0; }
    .warning p { color: #92400e; font-size: 14px; margin: 0; }
    .warning strong { color: #78350f; }
    .button-container { text-align: center; margin: 30px 0; }
    .button { background: #10b981; color: white; padding: 14px 40px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: 600; font-size: 15px; transition: background 0.3s; }
    .button:hover { background: #059669; }
    .footer-text { font-size: 14px; color: #475569; margin-top: 30px; line-height: 1.7; }
    .signature { margin-top: 25px; padding-top: 20px; border-top: 1px solid #e2e8f0; }
    .signature p { margin: 4px 0; color: #64748b; font-size: 14px; }
    .footer { background: #f8fafc; padding: 25px 30px; text-align: center; border-top: 1px solid #e2e8f0; }
    .footer p { color: #94a3b8; font-size: 12px; margin: 6px 0; }
  </style>
</head>
<body>
  <div class="email-wrapper">
    <div class="container">
      <div class="header">
        <span class="emoji">🚀</span>
        <h1>You're Shortlisted!</h1>
      </div>
      
      <div class="content">
        <p class="greeting">Dear <strong>${params.name}</strong>,</p>
        
        <div class="celebration">
          <p>🎉 Exciting news! Your team has been shortlisted to participate in VisionHack 2025!</p>
        </div>
        
        <p class="intro-text">Your team has been selected by <strong>${params.institutionName || 'your institution'}</strong> to represent them at this prestigious hackathon.</p>
        
        <div class="capabilities">
          <h3>As a Team Lead, you can:</h3>
          <ul>
            <li>Register your team details and members</li>
            <li>Submit your project for the hackathon</li>
            <li>Track your team's progress throughout the event</li>
          </ul>
        </div>
        
        <div class="credentials">
          <h3>🔐 Your Login Credentials</h3>
          <div class="credential-item">
            <div class="credential-label">Email Address</div>
            <div class="credential-value">${params.email}</div>
          </div>
          <div class="credential-item">
            <div class="credential-label">Temporary Password</div>
            <div class="credential-value">${params.password}</div>
          </div>
        </div>
        
        <div class="button-container">
          <a href="https://portal.mulearn.org/auth/login" class="button">Login to Dashboard →</a>
        </div>
        
        <p class="footer-text">We're excited to see what your team will create! Good luck! 🌟</p>
        
        <div class="signature">
          <p>Best regards,</p>
          <p><strong>VisionHack Team</strong></p>
        </div>
      </div>
      
      <div class="footer">
        <p>This is an automated email. Please do not reply to this message.</p>
        <p>&copy; 2025 VisionHack. All rights reserved.</p>
      </div>
    </div>
  </div>
</body>
</html>
  `.trim();
}