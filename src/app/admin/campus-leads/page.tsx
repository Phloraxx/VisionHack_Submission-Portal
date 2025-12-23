// Admin page for uploading CSV and creating campus leads
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FadeIn } from '@/components/animations/FadeIn';
import { SlideIn } from '@/components/animations/SlideIn';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Upload, Users, Mail, CheckCircle, XCircle, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';

interface CSVRow {
  collegeName: string;
  campusLeadName: string;
  email: string;
}

interface CreateResult {
  collegeName: string;
  email: string;
  success: boolean;
  error?: string;
}

export default function BulkCreateCampusLeads() {
  const router = useRouter();
  const [isUploading, setIsUploading] = useState(false);
  const [isCreatingSingle, setIsCreatingSingle] = useState(false);
  const [csvData, setCsvData] = useState<CSVRow[]>([]);
  const [results, setResults] = useState<CreateResult[]>([]);
  const [summary, setSummary] = useState<{
    accountsCreated: number;
    institutionsCreated: number;
    emailsSent: number;
    total: number;
  } | null>(null);

  // Single campus lead form state
  const [singleLead, setSingleLead] = useState({
    collegeName: '',
    campusLeadName: '',
    email: '',
  });

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const rows = text.split('\n').filter(row => row.trim());
      
      // Skip header row and parse CSV
      const data = rows.slice(1).map(row => {
        const [collegeName, campusLeadName, email] = row.split(',').map(cell => cell.trim());
        return { collegeName, campusLeadName, email };
      }).filter(row => row.collegeName && row.campusLeadName && row.email);
      
      setCsvData(data);
      toast.success(`Loaded ${data.length} campus leads from CSV`);
    };
    
    reader.readAsText(file);
  };

  const handleBulkCreate = async () => {
    if (csvData.length === 0) {
      toast.error('Please upload a CSV file first');
      return;
    }

    setIsUploading(true);
    
    try {
      const response = await fetch('/api/admin/create-campus-leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leads: csvData }),
      });

      const data = await response.json();

      if (data.success) {
        setResults(data.results);
        setSummary({
          accountsCreated: data.accountsCreated,
          institutionsCreated: data.institutionsCreated,
          emailsSent: data.emailsSent,
          total: data.total,
        });
        toast.success(`Successfully created ${data.accountsCreated} campus lead accounts!`);
      } else {
        toast.error(data.error || 'Failed to create campus leads');
      }
    } catch (error: any) {
      console.error('Error creating campus leads:', error);
      toast.error('An error occurred while creating campus leads');
    } finally {
      setIsUploading(false);
    }
  };

  const handleCreateSingle = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!singleLead.collegeName || !singleLead.campusLeadName || !singleLead.email) {
      toast.error('Please fill in all fields');
      return;
    }

    setIsCreatingSingle(true);

    try {
      const response = await fetch('/api/admin/create-campus-leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leads: [singleLead] }),
      });

      const data = await response.json();

      if (data.success) {
        toast.success(`Successfully created campus lead for ${singleLead.collegeName}!`);
        setSingleLead({ collegeName: '', campusLeadName: '', email: '' });
        
        // Update results if they exist
        if (results.length > 0) {
          setResults([...data.results, ...results]);
          setSummary({
            accountsCreated: (summary?.accountsCreated || 0) + data.accountsCreated,
            institutionsCreated: (summary?.institutionsCreated || 0) + data.institutionsCreated,
            emailsSent: (summary?.emailsSent || 0) + data.emailsSent,
            total: (summary?.total || 0) + data.total,
          });
        } else {
          setResults(data.results);
          setSummary({
            accountsCreated: data.accountsCreated,
            institutionsCreated: data.institutionsCreated,
            emailsSent: data.emailsSent,
            total: data.total,
          });
        }
      } else {
        toast.error(data.error || 'Failed to create campus lead');
      }
    } catch (error: any) {
      console.error('Error creating campus lead:', error);
      toast.error('An error occurred while creating campus lead');
    } finally {
      setIsCreatingSingle(false);
    }
  };

  return (
    <div className="container mx-auto px-6 py-12">
      <FadeIn>
        <div className="flex items-center gap-4 mb-8">
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push('/admin/dashboard')}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Dashboard
          </Button>
        </div>

        <div className="space-y-2 mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Create Campus Leads</h1>
          <p className="text-gray-600">Create campus lead accounts individually or via CSV upload</p>
        </div>
      </FadeIn>

      {/* Single Campus Lead Creation */}
      <SlideIn delay={0.05}>
        <Card className="border-gray-100 mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Create Single Campus Lead
            </CardTitle>
            <CardDescription>
              Quickly create one campus lead account for testing
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreateSingle} className="space-y-4">
              <div className="grid md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <label htmlFor="collegeName" className="text-sm font-medium">
                    College Name
                  </label>
                  <input
                    id="collegeName"
                    type="text"
                    placeholder="e.g., SCET"
                    value={singleLead.collegeName}
                    onChange={(e) => setSingleLead({ ...singleLead, collegeName: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="campusLeadName" className="text-sm font-medium">
                    Campus Lead Name
                  </label>
                  <input
                    id="campusLeadName"
                    type="text"
                    placeholder="e.g., John Doe"
                    value={singleLead.campusLeadName}
                    onChange={(e) => setSingleLead({ ...singleLead, campusLeadName: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="email" className="text-sm font-medium">
                    Email
                  </label>
                  <input
                    id="email"
                    type="email"
                    placeholder="john@scet.ac.in"
                    value={singleLead.email}
                    onChange={(e) => setSingleLead({ ...singleLead, email: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  />
                </div>
              </div>
              <Button type="submit" disabled={isCreatingSingle} className="w-full md:w-auto">
                {isCreatingSingle ? (
                  <>Creating...</>
                ) : (
                  <>
                    <Users className="h-4 w-4 mr-2" />
                    Create Campus Lead
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </SlideIn>

      <div className="grid lg:grid-cols-2 gap-6">
        <SlideIn delay={0.1}>
          <Card className="border-gray-100">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Upload className="h-5 w-5" />
                Bulk Upload via CSV
              </CardTitle>
              <CardDescription>
                CSV format: collegeName, campusLeadName, email
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
                <input
                  type="file"
                  accept=".csv"
                  onChange={handleFileUpload}
                  className="hidden"
                  id="csv-upload"
                />
                <label
                  htmlFor="csv-upload"
                  className="cursor-pointer flex flex-col items-center gap-2"
                >
                  <Upload className="h-12 w-12 text-gray-400" />
                  <p className="text-sm text-gray-600">
                    Click to upload CSV file
                  </p>
                  <p className="text-xs text-gray-500">
                    or drag and drop
                  </p>
                </label>
              </div>

              {csvData.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">
                    📊 Loaded {csvData.length} campus leads
                  </p>
                  <div className="max-h-48 overflow-y-auto border rounded p-3 bg-gray-50">
                    {csvData.slice(0, 10).map((row, index) => (
                      <div key={index} className="text-xs py-1 border-b last:border-0">
                        <span className="font-medium">{row.collegeName}</span> - {row.campusLeadName} ({row.email})
                      </div>
                    ))}
                    {csvData.length > 10 && (
                      <p className="text-xs text-gray-500 mt-2">
                        ... and {csvData.length - 10} more
                      </p>
                    )}
                  </div>
                  
                  <Button
                    onClick={handleBulkCreate}
                    disabled={isUploading}
                    className="w-full"
                  >
                    {isUploading ? (
                      <>Creating accounts...</>
                    ) : (
                      <>
                        <Users className="h-4 w-4 mr-2" />
                        Create {csvData.length} Campus Leads
                      </>
                    )}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </SlideIn>

        <SlideIn delay={0.2}>
          <Card className="border-gray-100">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mail className="h-5 w-5" />
                Results
              </CardTitle>
              <CardDescription>
                Account creation and email sending status
              </CardDescription>
            </CardHeader>
            <CardContent>
              {summary ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 bg-green-50 rounded-lg">
                      <p className="text-sm text-gray-600">Accounts Created</p>
                      <p className="text-2xl font-bold text-green-600">
                        {summary.accountsCreated}/{summary.total}
                      </p>
                    </div>
                    <div className="p-4 bg-blue-50 rounded-lg">
                      <p className="text-sm text-gray-600">Institutions</p>
                      <p className="text-2xl font-bold text-blue-600">
                        {summary.institutionsCreated}
                      </p>
                    </div>
                    <div className="p-4 bg-purple-50 rounded-lg col-span-2">
                      <p className="text-sm text-gray-600">Emails Sent</p>
                      <p className="text-2xl font-bold text-purple-600">
                        {summary.emailsSent}/{summary.accountsCreated}
                      </p>
                    </div>
                  </div>

                  <div className="max-h-64 overflow-y-auto border rounded p-3">
                    {results.map((result, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between py-2 border-b last:border-0"
                      >
                        <div className="flex-1">
                          <p className="text-sm font-medium">{result.collegeName}</p>
                          <p className="text-xs text-gray-600">{result.email}</p>
                        </div>
                        {result.success ? (
                          <CheckCircle className="h-5 w-5 text-green-600" />
                        ) : (
                          <XCircle className="h-5 w-5 text-red-600" />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-center py-12 text-gray-500">
                  <Mail className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                  <p>Upload a CSV file and click create to see results</p>
                </div>
              )}
            </CardContent>
          </Card>
        </SlideIn>
      </div>

      <SlideIn delay={0.3}>
        <Card className="border-gray-100 mt-6">
          <CardHeader>
            <CardTitle>CSV Format Requirements</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <p className="text-sm text-gray-600">
                Your CSV file should have the following columns (in order):
              </p>
              <div className="bg-gray-50 p-4 rounded font-mono text-sm">
                <div className="font-bold mb-2">collegeName,campusLeadName,email</div>
                <div>MIT College of Engineering,John Doe,john@example.com</div>
                <div>Stanford University,Jane Smith,jane@example.com</div>
                <div>Harvard University,Bob Johnson,bob@example.com</div>
              </div>
              <ul className="text-sm text-gray-600 space-y-1 mt-4">
                <li>• First row should be the header</li>
                <li>• Each campus lead will receive an auto-generated password</li>
                <li>• Credentials will be sent to their email addresses</li>
                <li>• Campus leads can log in and invite 5 team leads each</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </SlideIn>
    </div>
  );
}
