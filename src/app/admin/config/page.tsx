
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FadeIn } from '@/components/animations/FadeIn';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { authHelpers, UserRole } from '@/lib/appwrite';
import { toast } from 'sonner';
import { Shield, Save, Loader2, Users, FileText, UserPlus, Info } from 'lucide-react';

export default function AdminConfigPage() {
    const router = useRouter();
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    // Config State
    const [config, setConfig] = useState({
        registration: false,
        nomination: false,
        submissions: false,
        questionnaire: false
    });

    useEffect(() => {
        const checkAuth = async () => {
            const user = await authHelpers.getCurrentUser();
            if (!user) {
                router.push('/auth/login');
                return;
            }
            const role = authHelpers.getUserRole(user);
            if (!role || role !== UserRole.ADMIN) {
                router.push(role ? authHelpers.getRoleDashboard(role) : '/auth/login');
                return;
            }

            // Fetch current config
            try {
                const response = await fetch('/api/admin/config');
                const data = await response.json();
                if (data.success && data.config) {
                    setConfig({
                        registration: data.config.registration || false,
                        nomination: data.config.nomination || false,
                        submissions: data.config.submissions || false,
                        questionnaire: data.config.questionnaire || false
                    });
                }
            } catch (error) {
                console.error('Failed to fetch config', error);
                toast.error('Failed to load configuration');
            }
            setIsLoading(false);
        };
        checkAuth();
    }, [router]);

    const handleToggle = async (key: 'registration' | 'nomination' | 'submissions' | 'questionnaire', value: boolean) => {
        // Optimistic update
        const newConfig = { ...config, [key]: value };
        setConfig(newConfig);

        try {
            const response = await fetch('/api/admin/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ [key]: value }) // Send partial or full update? API handles partials.
            });
            const data = await response.json();

            if (data.success) {
                toast.success(`${key.charAt(0).toUpperCase() + key.slice(1)} updated`);
            } else {
                toast.error('Failed to update configuration');
                // Revert on failure
                setConfig({ ...config, [key]: !value });
            }
        } catch (error) {
            console.error('Error saving config:', error);
            toast.error('Connection error');
            setConfig({ ...config, [key]: !value });
        }
    };

    if (isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
            </div>
        );
    }

    return (
        <div className="container mx-auto px-6 py-12">
            <FadeIn>
                <div className="max-w-4xl mx-auto mb-8">
                    <h1 className="text-3xl font-bold tracking-tight mb-2">Event Configuration</h1>
                    <p className="text-gray-600">Manage global settings for the hackathon event stages.</p>
                </div>
            </FadeIn>

            <div className="max-w-4xl mx-auto grid gap-6">
                {/* Registration Control */}
                <Card className={`border-l-4 transition-all ${config.registration ? 'border-l-green-500' : 'border-l-gray-300'}`}>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <div className="space-y-1">
                            <CardTitle className="text-xl flex items-center gap-2">
                                <UserPlus className="h-5 w-5" />
                                Team Registration
                            </CardTitle>
                            <CardDescription>
                                Allow Campus Leads to invite new Team Leads.
                            </CardDescription>
                        </div>
                        <div className="flex items-center space-x-2">
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    className="sr-only peer"
                                    checked={config.registration}
                                    onChange={(e) => handleToggle('registration', e.target.checked)}
                                />
                                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                            </label>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-sm text-gray-500 mt-2 flex items-start gap-2 bg-gray-50 p-3 rounded">
                            <Info className="h-4 w-4 mt-0.5 shrink-0" />
                            <p>
                                <strong>Enabled:</strong> Campus Leads can send invites to add new teams to the waitlist.<br />
                                <strong>Disabled:</strong> The "Invite" button will be locked for all Campus Leads.
                            </p>
                        </div>
                    </CardContent>
                </Card>

                {/* Questionnaire Control */}
                <Card className={`border-l-4 transition-all ${config.questionnaire ? 'border-l-green-500' : 'border-l-gray-300'}`}>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <div className="space-y-1">
                            <CardTitle className="text-xl flex items-center gap-2">
                                <FileText className="h-5 w-5" />
                                Questionnaire
                            </CardTitle>
                            <CardDescription>
                                Allow Teams to submit or edit their questionnaire.
                            </CardDescription>
                        </div>
                        <div className="flex items-center space-x-2">
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    className="sr-only peer"
                                    checked={config.questionnaire}
                                    onChange={(e) => handleToggle('questionnaire', e.target.checked)}
                                />
                                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                            </label>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-sm text-gray-500 mt-2 flex items-start gap-2 bg-gray-50 p-3 rounded">
                            <Info className="h-4 w-4 mt-0.5 shrink-0" />
                            <p>
                                <strong>Enabled:</strong> Teams can access and submit/edit their questionnaire.<br />
                                <strong>Disabled:</strong> Questionnaire access is read-only or blocked.
                            </p>
                        </div>
                    </CardContent>
                </Card>

                {/* Nomination Control */}
                <Card className={`border-l-4 transition-all ${config.nomination ? 'border-l-green-500' : 'border-l-gray-300'}`}>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <div className="space-y-1">
                            <CardTitle className="text-xl flex items-center gap-2">
                                <Shield className="h-5 w-5" />
                                Team Nomination (Approval)
                            </CardTitle>
                            <CardDescription>
                                Allow Campus Leads to Approve (Shortlist) teams.
                            </CardDescription>
                        </div>
                        <div className="flex items-center space-x-2">
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    className="sr-only peer"
                                    checked={config.nomination}
                                    onChange={(e) => handleToggle('nomination', e.target.checked)}
                                />
                                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-purple-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
                            </label>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-sm text-gray-500 mt-2 flex items-start gap-2 bg-gray-50 p-3 rounded">
                            <Info className="h-4 w-4 mt-0.5 shrink-0" />
                            <p>
                                <strong>Enabled:</strong> Campus Leads can move teams from Waitlisted to Registered (Approved).<br />
                                <strong>Disabled:</strong> The "Approve" button will be locked. Unapproving might also be restricted depending on policy.
                            </p>
                        </div>
                    </CardContent>
                </Card>

                {/* Submission Control */}
                <Card className={`border-l-4 transition-all ${config.submissions ? 'border-l-green-500' : 'border-l-gray-300'}`}>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <div className="space-y-1">
                            <CardTitle className="text-xl flex items-center gap-2">
                                <FileText className="h-5 w-5" />
                                Idea Submission
                            </CardTitle>
                            <CardDescription>
                                Allow Team Leads to submit their ideas.
                            </CardDescription>
                        </div>
                        <div className="flex items-center space-x-2">
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    className="sr-only peer"
                                    checked={config.submissions}
                                    onChange={(e) => handleToggle('submissions', e.target.checked)}
                                />
                                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-green-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-600"></div>
                            </label>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-sm text-gray-500 mt-2 flex items-start gap-2 bg-gray-50 p-3 rounded">
                            <Info className="h-4 w-4 mt-0.5 shrink-0" />
                            <p>
                                <strong>Enabled:</strong> Approved Team Leads can access the Idea Submission page and submit their work.<br />
                                <strong>Disabled:</strong> The submission page will be accessible but submission will be blocked or the page itself locked.
                            </p>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
