'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { FadeIn } from '@/components/animations/FadeIn';
import { SlideIn } from '@/components/animations/SlideIn';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { authHelpers, UserRole, databases, DATABASE_ID, COLLECTIONS } from '@/lib/appwrite';
import { Query } from 'appwrite';
import { Upload, FileText, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export default function SubmitIdeaPage() {
    const router = useRouter();
    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [userId, setUserId] = useState('');

    const [ideaTitle, setIdeaTitle] = useState('');
    const [ideaDescription, setIdeaDescription] = useState('');
    const [techStack, setTechStack] = useState('');
    const [file, setFile] = useState<File | null>(null);

    const [existingSubmission, setExistingSubmission] = useState(false);
    const [status, setStatus] = useState('');

    useEffect(() => {
        const checkAuth = async () => {
            const user = await authHelpers.getCurrentUser();
            if (!user) {
                router.push('/auth/login');
                return;
            }
            const role = authHelpers.getUserRole(user);
            if (!role || role !== UserRole.TEAM_LEAD) {
                router.push(role ? authHelpers.getRoleDashboard(role) : '/auth/login');
                return;
            }
            setUserId(user.$id);

            // Fetch config
            try {
                const confRes = await fetch('/api/admin/config');
                const confData = await confRes.json();
                if (confData.success && confData.config) {
                    if (!confData.config.submissions) {
                        toast.error("Idea submissions are currently closed.");
                        router.push('/team/dashboard');
                        return;
                    }
                }
            } catch (e) {
                console.error("Failed to load config");
            }

            // Fetch team data
            try {
                const teamsResponse = await databases.listDocuments(
                    DATABASE_ID,
                    COLLECTIONS.TEAMS,
                    [Query.equal('leader_user_id', user.$id)]
                );

                if (teamsResponse.total > 0) {
                    const team = teamsResponse.documents[0] as any;
                    if (team.idea_title) {
                        setIdeaTitle(team.idea_title);
                        setIdeaDescription(team.idea_desc || '');
                        setTechStack(team.idea_tech_stack || '');
                        setExistingSubmission(true);
                    }
                    setStatus(team.status);
                } else {
                    toast.error("Team not found. Please register your team first.");
                    router.push('/team/dashboard');
                }
            } catch (error) {
                console.error("Error fetching team:", error);
            }
            setIsLoading(false);
        };
        checkAuth();
    }, [router]);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setFile(e.target.files[0]);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!file && !existingSubmission) {
            toast.error("Please upload a file.");
            return;
        }

        // If existing submission and no new file, we might just update text?
        // For simplicity, let's require file again if they are re-submitting, or handle partial update.
        // API currently expects all fields. Let's force re-upload for now for simplicity unless user objects.
        if (!file && existingSubmission) {
            // If they didn't change the file, we can't send it. 
            // Need to update API to handle optional file for updates.
            // For now, let's just ask them to upload again or leave it.
            // Let's assume they must upload a file if they are submitting.
            if (!window.confirm("You haven't selected a new file. Do you want to proceed? (Previous file might be preserved logic not implemented, so please upload file again)")) {
                return;
            }
            // Actually, my API requires file. So I must enforce it.
            toast.error("Please upload the PPT/PDF file.");
            return;
        }

        setIsSubmitting(true);

        try {
            const formData = new FormData();
            formData.append('userId', userId);
            formData.append('ideaTitle', ideaTitle);
            formData.append('ideaDescription', ideaDescription);
            formData.append('techStack', techStack);
            if (file) {
                formData.append('file', file);
            }

            const response = await fetch('/api/team/submit-idea', {
                method: 'POST',
                body: formData,
            });

            const data = await response.json();

            if (data.success) {
                toast.success("Idea submitted successfully!");
                setTimeout(() => router.push('/team/dashboard'), 1500);
            } else {
                toast.error(data.error || "Submission failed");
            }
        } catch (error) {
            console.error("Submission error:", error);
            toast.error("An error occurred during submission.");
        } finally {
            setIsSubmitting(false);
        }
    };

    if (isLoading) {
        return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
    }

    return (
        <div className="container mx-auto px-6 py-12">
            <FadeIn>
                <div className="max-w-3xl mx-auto mb-8 space-y-2">
                    <h1 className="text-3xl font-bold tracking-tight">Submit Your Idea</h1>
                    <p className="text-gray-600">Share your innovation with us. Upload your presentation and details.</p>
                </div>
            </FadeIn>

            <div className="max-w-3xl mx-auto">
                <SlideIn delay={0.1}>
                    <Card className="border-gray-100">
                        <CardHeader>
                            <CardTitle>Project Details</CardTitle>
                            <CardDescription>Fill in the details of your project.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <form onSubmit={handleSubmit} className="space-y-6">
                                <div className="space-y-2">
                                    <Label htmlFor="title">Idea Title</Label>
                                    <Input
                                        id="title"
                                        value={ideaTitle}
                                        onChange={(e) => setIdeaTitle(e.target.value)}
                                        placeholder="Enter project title"
                                        required
                                    />
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="desc">Description</Label>
                                    <Textarea
                                        id="desc"
                                        value={ideaDescription}
                                        onChange={(e) => setIdeaDescription(e.target.value)}
                                        placeholder="Describe your idea briefly..."
                                        className="min-h-[120px]"
                                        required
                                    />
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="stack">Tech Stack</Label>
                                    <Input
                                        id="stack"
                                        value={techStack}
                                        onChange={(e) => setTechStack(e.target.value)}
                                        placeholder="e.g. Next.js, Python, Flutter"
                                        required
                                    />
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="file">Presentation (PDF/PPT)</Label>
                                    <div className="border-2 border-dashed border-gray-200 rounded-lg p-6 flex flex-col items-center justify-center bg-gray-50 hover:bg-gray-100 transition-colors cursor-pointer relative focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
                                        <Input
                                            id="file"
                                            type="file"
                                            accept=".pdf,.ppt,.pptx"
                                            onChange={handleFileChange}
                                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                            required={!existingSubmission}
                                        />
                                        <Upload className="h-8 w-8 text-gray-400 mb-2" />
                                        <p className="text-sm font-medium text-gray-700">
                                            {file ? file.name : "Click to upload or drag and drop"}
                                        </p>
                                        <p className="text-xs text-gray-500 mt-1">PDF, PPT or PPTX (Max 10MB)</p>
                                    </div>
                                </div>

                                <Button type="submit" className="w-full" disabled={isSubmitting}>
                                    {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                    {isSubmitting ? 'Submitting...' : 'Submit Idea'}
                                </Button>
                            </form>
                        </CardContent>
                    </Card>
                </SlideIn>
            </div>
        </div>
    );
}
