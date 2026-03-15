'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { FadeIn } from '@/components/animations/FadeIn';
import { SlideIn } from '@/components/animations/SlideIn';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import { authHelpers, UserRole, databases, DATABASE_ID, COLLECTIONS, ID } from '@/lib/appwrite';
import { Query } from 'appwrite';
import { toast } from 'sonner';
import { Loader2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function QuestionnairePage() {
    const router = useRouter();
    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isQuestionnaireOpen, setIsQuestionnaireOpen] = useState(false);

    // Auth & Context
    const [user, setUser] = useState<any>(null);
    const [team, setTeam] = useState<any>(null);
    const [existingResponseId, setExistingResponseId] = useState<string | null>(null);

    // Form Data
    const [formData, setFormData] = useState({
        profile_id: '',
        age: '',       // Changed from age_group
        gender: '',    // New separate field
        education_level: '',

        current_activity: '',
        activity_other: '',
        activity_duration: '',

        is_primary_income: null as boolean | null, // Use null for unselected state
        monthly_income: '',

        has_formal_training: null as boolean | null,
        training_details: '',

        skills_to_improve: [] as string[],
        skills_other: '',

        resources_needed: [] as string[], // Format: "manpower:High", etc.
        challenges: '',

        sales_channels: [] as string[],
        sales_other: '',

        selling_difficulty: null as boolean | null,
        selling_difficulty_details: '',

        support_needed: [] as string[],
        support_other: '',

        growth_plans: [] as string[],

        mobile_usage: [] as string[],
        mobile_usage_other: '',
    });

    // Helper for resource ratings
    const [resourceRatings, setResourceRatings] = useState<Record<string, string>>({});

    // Validation Errors
    const [errors, setErrors] = useState<Record<string, string>>({});
    const errorRefs = useRef<Record<string, HTMLElement | null>>({});

    useEffect(() => {
        const init = async () => {
            try {
                const currentUser = await authHelpers.getCurrentUser();
                if (!currentUser) {
                    router.push('/auth/login');
                    return;
                }

                const role = authHelpers.getUserRole(currentUser);
                if (role !== UserRole.TEAM_LEAD) {
                    router.push('/team/dashboard'); // Only team leads
                    return;
                }

                setUser(currentUser);

                // Get Team
                const teamsRes = await databases.listDocuments(
                    DATABASE_ID,
                    COLLECTIONS.TEAMS,
                    [Query.equal('leader_user_id', currentUser.$id)]
                );

                if (teamsRes.total === 0) {
                    toast.error("Please register a team first");
                    router.push('/team/dashboard');
                    return;
                }

                const teamData = teamsRes.documents[0];
                setTeam(teamData);

                // Check existing response
                const respRes = await databases.listDocuments(
                    DATABASE_ID,
                    COLLECTIONS.QUESTIONNAIRE,
                    [Query.equal('team_id', teamData.$id)]
                );

                if (respRes.total > 0) {
                    const saved = respRes.documents[0];
                    setExistingResponseId(saved.$id);

                    // Parse resources needed back to ratings
                    const ratings: Record<string, string> = {};
                    saved.resources_needed.forEach((r: string) => {
                        const [key, val] = r.split(':');
                        // Handle potential $ prefix from old saves
                        const cleanKey = key.startsWith('$') ? key.substring(1) : key;
                        const cleanVal = val.startsWith('$') ? val.substring(1) : val;

                        if (cleanKey && cleanVal) ratings[cleanKey] = cleanVal;
                    });
                    setResourceRatings(ratings);

                    setFormData({
                        profile_id: saved.profile_id,
                        age: saved.age_group, // Store age in age_group attr
                        gender: saved.gender || '',
                        education_level: saved.education_level,
                        current_activity: saved.current_activity,
                        activity_other: saved.activity_other || '',
                        activity_duration: saved.activity_duration,
                        is_primary_income: saved.is_primary_income,
                        monthly_income: saved.monthly_income,
                        has_formal_training: saved.has_formal_training,
                        training_details: saved.training_details || '',
                        skills_to_improve: saved.skills_to_improve || [],
                        skills_other: saved.skills_other || '',
                        resources_needed: saved.resources_needed || [],
                        challenges: saved.challenges || '',
                        sales_channels: saved.sales_channels || [],
                        sales_other: saved.sales_other || '',
                        selling_difficulty: saved.selling_difficulty,
                        selling_difficulty_details: saved.selling_difficulty_details || '',
                        support_needed: saved.support_needed || [],
                        support_other: saved.support_other || '',
                        growth_plans: saved.growth_plans || [],
                        mobile_usage: saved.mobile_usage || [],
                        mobile_usage_other: saved.mobile_usage_other || '',
                    });
                } else {
                    setFormData(prev => ({ ...prev, profile_id: teamData.team_code || '' }));
                }

            } catch (error) {
                console.error("Init error:", error);
                toast.error("Failed to load data");
            } finally {
                setIsLoading(false);
            }
        };
        init();
    }, [router]);

    const handleCheckboxChange = (field: keyof typeof formData, value: string, checked: boolean) => {
        setFormData(prev => {
            const list = prev[field] as string[];
            if (checked) {
                return { ...prev, [field]: [...list, value] };
            } else {
                return { ...prev, [field]: list.filter(item => item !== value) };
            }
        });
        // Clear error if selection made
        if (errors[field]) {
            setErrors(prev => {
                const newErrors = { ...prev };
                delete newErrors[field];
                return newErrors;
            });
        }
    };

    const handleResourceRatingChange = (resource: string, rating: string) => {
        setResourceRatings(prev => {
            const next = { ...prev, [resource]: rating };
            return next;
        });
        if (errors['resources_needed']) {
            setErrors(prev => {
                const newErrors = { ...prev };
                delete newErrors['resources_needed'];
                return newErrors;
            });
        }
    };

    const validateForm = () => {
        const newErrors: Record<string, string> = {};

        // 1. Profile
        if (!formData.profile_id.trim()) newErrors.profile_id = "Profile ID is required";
        if (!formData.age.trim()) newErrors.age = "Age is required";
        if (!formData.gender) newErrors.gender = "Gender is required";
        if (!formData.education_level) newErrors.education_level = "Education level is required";

        // 2. Activity
        if (!formData.current_activity) newErrors.current_activity = "Current activity is required";
        if (formData.current_activity === "Other" && !formData.activity_other.trim()) {
            newErrors.activity_other = "Please specify the other activity";
        }
        if (!formData.activity_duration) newErrors.activity_duration = "Activity duration is required";
        if (formData.is_primary_income === null) newErrors.is_primary_income = "Please select yes or no";
        if (!formData.monthly_income) newErrors.monthly_income = "Monthly income is required";

        // 3. Skills
        if (formData.has_formal_training === null) newErrors.has_formal_training = "Please select yes or no";
        if (formData.has_formal_training === true && !formData.training_details.trim()) {
            newErrors.training_details = "Please provide training details";
        }

        // Skills to improve 
        // Logic: Require at least one skill OR 'Other' filled? doc say "Choose one or more" implied?
        // Let's require at least one selection or other text.
        if (formData.skills_to_improve.length === 0 && !formData.skills_other.trim()) {
            newErrors.skills_to_improve = "Select at least one skill or specify other";
        }

        // 4. Requirements
        // Resources needed. Do we require ALL to be rated? Or just some?
        // "Rate your need (High / Medium / Low)". Usually implies for all listed items.
        // Let's allow users to skip if not applicable? But prompt says "User has to answer them all".
        // Let's strictly require all 10 items to be rated? That might be annoying if irrelevant.
        // Let's require at least ONE resource rating to be safe, or maybe check if any are missing.
        // "The user has to answer them all" -> implies strictness.
        const resourceKeys = [
            "Manpower", "Storage space", "Work space / workshop", "Packaging equipment",
            "Marketing support", "Sales channels", "Financial support", "Digital tools",
            "Packaging & quality certification", "Transport & Logistics"
        ];
        const missingResources = resourceKeys.filter(k => !resourceRatings[k]);
        if (missingResources.length > 0) {
            newErrors.resources_needed = `Please rate all resources ($${missingResources.length} remaining)`;
        }

        // 5. Sales
        if (formData.sales_channels.length === 0 && !formData.sales_other.trim()) {
            newErrors.sales_channels = "Select at least one sales channel or specify other";
        }
        if (formData.selling_difficulty === null) newErrors.selling_difficulty = "Please select yes or no";
        if (formData.selling_difficulty === true && !formData.selling_difficulty_details.trim()) {
            newErrors.selling_difficulty_details = "Please specify the difficulties";
        }

        // 6. Support
        if (formData.support_needed.length === 0 && !formData.support_other.trim()) {
            newErrors.support_needed = "Select at least one support area or specify other";
        }
        if (formData.growth_plans.length === 0) {
            newErrors.growth_plans = "Select at least one growth plan";
        }
        if (formData.mobile_usage.length === 0 && !formData.mobile_usage_other.trim()) {
            newErrors.mobile_usage = "Select at least one mobile usage option";
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const scrollToFirstError = () => {
        // Find first error key
        const firstErrorKey = Object.keys(errors)[0];
        if (firstErrorKey && errorRefs.current[firstErrorKey]) {
            errorRefs.current[firstErrorKey]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            // Also focus if it's an input
            const input = errorRefs.current[firstErrorKey]?.querySelector('input, textarea');
            if (input instanceof HTMLElement) {
                input.focus();
            }
        } else {
            // Fallback: scroll to top if can't find specific element
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    };

    // Effect to scroll when errors update
    useEffect(() => {
        if (Object.keys(errors).length > 0) {
            scrollToFirstError();
        }
    }, [errors]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!validateForm()) {
            toast.error("Please fill in all required fields marked in red.");
            return;
        }

        setIsSubmitting(true);

        try {
            // Prepare resources array
            const resourcesArray = Object.entries(resourceRatings).map(([k, v]) => `${k}:${v}`);

            const payload = {
                user_id: user.$id,
                team_id: team.$id,
                profile_id: formData.profile_id,
                age_group: formData.age,
                gender: formData.gender,
                education_level: formData.education_level,
                current_activity: formData.current_activity,
                activity_other: formData.activity_other,
                activity_duration: formData.activity_duration,
                is_primary_income: formData.is_primary_income === true,
                monthly_income: formData.monthly_income,
                has_formal_training: formData.has_formal_training === true,
                training_details: formData.training_details,
                skills_to_improve: formData.skills_to_improve,
                skills_other: formData.skills_other,
                resources_needed: resourcesArray,
                challenges: formData.challenges,
                sales_channels: formData.sales_channels,
                sales_other: formData.sales_other,
                selling_difficulty: formData.selling_difficulty === true,
                selling_difficulty_details: formData.selling_difficulty_details,
                support_needed: formData.support_needed,
                support_other: formData.support_other,
                growth_plans: formData.growth_plans,
                mobile_usage: formData.mobile_usage,
                mobile_usage_other: formData.mobile_usage_other,
            };

            if (existingResponseId) {
                await databases.updateDocument(
                    DATABASE_ID,
                    COLLECTIONS.QUESTIONNAIRE,
                    existingResponseId,
                    payload
                );

                // Also ensure team status is updated if it was just registered
                if (team.status === 'registered') {
                    await databases.updateDocument(
                        DATABASE_ID,
                        COLLECTIONS.TEAMS,
                        team.$id,
                        { status: 'questionnaire_submitted' }
                    );
                }

                toast.success("Questionnaire updated successfully");
            } else {
                await databases.createDocument(
                    DATABASE_ID,
                    COLLECTIONS.QUESTIONNAIRE,
                    ID.unique(),
                    payload
                );

                // Update team status to questionnaire_submitted
                await databases.updateDocument(
                    DATABASE_ID,
                    COLLECTIONS.TEAMS,
                    team.$id,
                    { status: 'questionnaire_submitted' }
                );

                toast.success("Questionnaire submitted successfully");
                setTimeout(() => router.push('/team/dashboard'), 1500);
            }

        } catch (error: any) {
            console.error("Submit error:", error);
            toast.error(error.message || "Failed to submit questionnaire");
        } finally {
            setIsSubmitting(false);
        }
    };

    // Helper to register refs
    const setRef = (key: string) => (el: HTMLElement | null) => {
        errorRefs.current[key] = el;
    };

    if (isLoading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin" /></div>;

    return (
        <div className="container mx-auto px-4 py-8 max-w-4xl">
            <FadeIn>
                <div className="space-y-2 mb-8">
                    <h1 className="text-3xl font-bold tracking-tight">Team Profile Questionnaire</h1>
                    <p className="text-gray-600">Complete this detailed profile to help us understand your team better.</p>
                    {!isQuestionnaireOpen && (
                        <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-800 flex items-center gap-2 mt-4">
                            <AlertCircle className="h-5 w-5" />
                            <p className="font-medium">Questionnaire submissions are currently closed. You can view your answers but cannot make changes.</p>
                        </div>
                    )}
                </div>
            </FadeIn>

            <form onSubmit={handleSubmit}>
                <fieldset disabled={!isQuestionnaireOpen} className="space-y-8 disabled:opacity-80 pb-12">

                    {/* 1. Profile */}
                    <Section title="1. Profile Details">
                        <div className="grid gap-6 md:grid-cols-2">
                            <div className="space-y-2" ref={setRef('profile_id')}>
                                <Label className={errors.profile_id ? "text-red-500" : ""}>Profile ID / Team Code *</Label>
                                <Input
                                    value={formData.profile_id}
                                    onChange={e => {
                                        setFormData({ ...formData, profile_id: e.target.value });
                                        if (e.target.value) setErrors(p => ({ ...p, profile_id: '' }));
                                    }}
                                    className={errors.profile_id ? "border-red-500" : ""}
                                />
                                {errors.profile_id && <p className="text-sm text-red-500">{errors.profile_id}</p>}
                            </div>

                            <div className="space-y-2" ref={setRef('age')}>
                                <Label className={errors.age ? "text-red-500" : ""}>Age *</Label>
                                <Input
                                    type="number"
                                    placeholder="Age"
                                    value={formData.age}
                                    onChange={e => {
                                        setFormData({ ...formData, age: e.target.value });
                                        if (e.target.value) setErrors(p => ({ ...p, age: '' }));
                                    }}
                                    className={errors.age ? "border-red-500" : ""}
                                />
                                {errors.age && <p className="text-sm text-red-500">{errors.age}</p>}
                            </div>

                            <div className="space-y-2" ref={setRef('gender')}>
                                <Label className={errors.gender ? "text-red-500" : ""}>Gender *</Label>
                                <RadioGroup
                                    value={formData.gender}
                                    onValueChange={v => {
                                        setFormData({ ...formData, gender: v });
                                        setErrors(p => ({ ...p, gender: '' }));
                                    }}
                                    className="flex gap-6 mt-2"
                                >
                                    <div className="flex items-center space-x-2">
                                        <RadioGroupItem value="Male" id="gender-male" />
                                        <Label htmlFor="gender-male" className="font-normal">Male</Label>
                                    </div>
                                    <div className="flex items-center space-x-2">
                                        <RadioGroupItem value="Female" id="gender-female" />
                                        <Label htmlFor="gender-female" className="font-normal">Female</Label>
                                    </div>
                                    <div className="flex items-center space-x-2">
                                        <RadioGroupItem value="Other" id="gender-other" />
                                        <Label htmlFor="gender-other" className="font-normal">Other</Label>
                                    </div>
                                </RadioGroup>
                                {errors.gender && <p className="text-sm text-red-500">{errors.gender}</p>}
                            </div>

                            <div className="space-y-2 md:col-span-2" ref={setRef('education_level')}>
                                <Label className={errors.education_level ? "text-red-500" : ""}>Education Level *</Label>
                                <RadioGroup
                                    value={formData.education_level}
                                    onValueChange={v => {
                                        setFormData({ ...formData, education_level: v });
                                        setErrors(p => ({ ...p, education_level: '' }));
                                    }}
                                    className="grid md:grid-cols-2 gap-4 mt-2"
                                >
                                    {["No formal education", "Primary", "Secondary", "Higher Secondary", "Graduate / Diploma / Professional"].map(opt => (
                                        <div key={opt} className="flex items-center space-x-2">
                                            <RadioGroupItem value={opt} id={`edu-${opt}`} />
                                            <Label htmlFor={`edu-${opt}`} className="font-normal">{opt}</Label>
                                        </div>
                                    ))}
                                </RadioGroup>
                                {errors.education_level && <p className="text-sm text-red-500">{errors.education_level}</p>}
                            </div>
                        </div>
                    </Section>

                    {/* 2. Activity */}
                    <Section title="2. Information on Livelihood Activity">
                        <div className="space-y-6">
                            <div className="space-y-3" ref={setRef('current_activity')}>
                                <Label className={errors.current_activity ? "text-red-500" : ""}>Which activities are you currently engaged in? *</Label>
                                <RadioGroup
                                    value={formData.current_activity}
                                    onValueChange={v => {
                                        setFormData({ ...formData, current_activity: v });
                                        setErrors(p => ({ ...p, current_activity: '' }));
                                    }}
                                    className="grid md:grid-cols-2 gap-4"
                                >
                                    {[
                                        "Food production / processing",
                                        "Café / catering",
                                        "Apparel / handicraft making",
                                        "Agriculture / farming / nursery",
                                        "Waste management (Haritha Karma Sena)",
                                        "Construction work",
                                        "Sales / trading products",
                                        "Marketing / distribution",
                                        "Services (housekeeping, wellness, driving)",
                                        "Other"
                                    ].map(opt => (
                                        <div key={opt} className="flex items-center space-x-2">
                                            <RadioGroupItem value={opt} id={`act-${opt}`} />
                                            <Label htmlFor={`act-${opt}`} className="font-normal">{opt}</Label>
                                        </div>
                                    ))}
                                </RadioGroup>
                                {errors.current_activity && <p className="text-sm text-red-500">{errors.current_activity}</p>}

                                {formData.current_activity === "Other" && (
                                    <div className="mt-2" ref={setRef('activity_other')}>
                                        <Input
                                            placeholder="Specify other activity"
                                            value={formData.activity_other}
                                            onChange={e => {
                                                setFormData({ ...formData, activity_other: e.target.value });
                                                if (e.target.value) setErrors(p => ({ ...p, activity_other: '' }));
                                            }}
                                            className={errors.activity_other ? "border-red-500" : ""}
                                        />
                                        {errors.activity_other && <p className="text-sm text-red-500">{errors.activity_other}</p>}
                                    </div>
                                )}
                            </div>

                            <div className="grid md:grid-cols-2 gap-6">
                                <div className="space-y-3" ref={setRef('activity_duration')}>
                                    <Label className={errors.activity_duration ? "text-red-500" : ""}>How long have you been doing this? *</Label>
                                    <RadioGroup
                                        value={formData.activity_duration}
                                        onValueChange={v => {
                                            setFormData({ ...formData, activity_duration: v });
                                            setErrors(p => ({ ...p, activity_duration: '' }));
                                        }}
                                    >
                                        <div className="flex items-center space-x-2">
                                            <RadioGroupItem value="Less than 1 year" id="dur-less" />
                                            <Label htmlFor="dur-less">Less than 1 year</Label>
                                        </div>
                                        <div className="flex items-center space-x-2">
                                            <RadioGroupItem value="More than 1 year" id="dur-more" />
                                            <Label htmlFor="dur-more">More than 1 year</Label>
                                        </div>
                                    </RadioGroup>
                                    {errors.activity_duration && <p className="text-sm text-red-500">{errors.activity_duration}</p>}
                                </div>

                                <div className="space-y-3" ref={setRef('is_primary_income')}>
                                    <Label className={errors.is_primary_income ? "text-red-500" : ""}>Is this your primary source of income? *</Label>
                                    <RadioGroup
                                        value={formData.is_primary_income === true ? "yes" : (formData.is_primary_income === false ? "no" : "")}
                                        onValueChange={v => {
                                            setFormData({ ...formData, is_primary_income: v === "yes" });
                                            setErrors(p => ({ ...p, is_primary_income: '' }));
                                        }}
                                    >
                                        <div className="flex items-center space-x-2">
                                            <RadioGroupItem value="yes" id="inc-yes" />
                                            <Label htmlFor="inc-yes">Yes</Label>
                                        </div>
                                        <div className="flex items-center space-x-2">
                                            <RadioGroupItem value="no" id="inc-no" />
                                            <Label htmlFor="inc-no">No</Label>
                                        </div>
                                    </RadioGroup>
                                    {errors.is_primary_income && <p className="text-sm text-red-500">{errors.is_primary_income}</p>}
                                </div>
                            </div>

                            <div className="space-y-3" ref={setRef('monthly_income')}>
                                <Label className={errors.monthly_income ? "text-red-500" : ""}>Average monthly income *</Label>
                                <RadioGroup
                                    value={formData.monthly_income}
                                    onValueChange={v => {
                                        setFormData({ ...formData, monthly_income: v });
                                        setErrors(p => ({ ...p, monthly_income: '' }));
                                    }}
                                    className="grid md:grid-cols-3 gap-4"
                                >
                                    {[
                                        "< ₹5,000",
                                        "₹5,001–₹10,000",
                                        "₹10,001–₹20,000",
                                        "₹20,000",
                                        "More than 20,000"
                                    ].map(opt => (
                                        <div key={opt} className="flex items-center space-x-2">
                                            <RadioGroupItem value={opt} id={`income-${opt}`} />
                                            <Label htmlFor={`income-${opt}`} className="font-normal">{opt}</Label>
                                        </div>
                                    ))}
                                </RadioGroup>
                                {errors.monthly_income && <p className="text-sm text-red-500">{errors.monthly_income}</p>}
                            </div>
                        </div>
                    </Section>

                    {/* 3. Skills */}
                    <Section title="3. Skills & Training">
                        <div className="space-y-6">
                            <div className="space-y-3" ref={setRef('has_formal_training')}>
                                <Label className={errors.has_formal_training ? "text-red-500" : ""}>Do you have any formal training? *</Label>
                                <RadioGroup
                                    value={formData.has_formal_training === true ? "yes" : (formData.has_formal_training === false ? "no" : "")}
                                    onValueChange={v => {
                                        setFormData({ ...formData, has_formal_training: v === "yes" });
                                        setErrors(p => ({ ...p, has_formal_training: '' }));
                                    }}
                                >
                                    <div className="flex items-center space-x-2">
                                        <RadioGroupItem value="yes" id="train-yes" />
                                        <Label htmlFor="train-yes">Yes</Label>
                                    </div>
                                    <div className="flex items-center space-x-2">
                                        <RadioGroupItem value="no" id="train-no" />
                                        <Label htmlFor="train-no">No</Label>
                                    </div>
                                </RadioGroup>
                                {errors.has_formal_training && <p className="text-sm text-red-500">{errors.has_formal_training}</p>}

                                {formData.has_formal_training === true && (
                                    <div className="mt-2" ref={setRef('training_details')}>
                                        <Input
                                            placeholder="If yes, what type and from whom?"
                                            value={formData.training_details}
                                            onChange={e => {
                                                setFormData({ ...formData, training_details: e.target.value });
                                                if (e.target.value) setErrors(p => ({ ...p, training_details: '' }));
                                            }}
                                            className={errors.training_details ? "border-red-500" : ""}
                                        />
                                        {errors.training_details && <p className="text-sm text-red-500">{errors.training_details}</p>}
                                    </div>
                                )}
                            </div>

                            <div className="space-y-3" ref={setRef('skills_to_improve')}>
                                <Label className={errors.skills_to_improve ? "text-red-500" : ""}>What skills do you need to improve? *</Label>
                                <div className="grid md:grid-cols-2 gap-4">
                                    {[
                                        "Technical production skills",
                                        "Digital/Mobile skills",
                                        "Quality control",
                                        "Pricing & costing",
                                        "Customer handling",
                                        "Marketing & branding"
                                    ].map(skill => (
                                        <div key={skill} className="flex items-center space-x-2">
                                            <Checkbox
                                                id={`skill-${skill}`}
                                                checked={formData.skills_to_improve.includes(skill)}
                                                onCheckedChange={(c) => handleCheckboxChange('skills_to_improve', skill, c as boolean)}
                                            />
                                            <Label htmlFor={`skill-${skill}`} className="font-normal">{skill}</Label>
                                        </div>
                                    ))}
                                </div>
                                <div className="flex items-center space-x-2 mt-2">
                                    <Label>Other:</Label>
                                    <Input
                                        value={formData.skills_other}
                                        onChange={e => {
                                            setFormData({ ...formData, skills_other: e.target.value });
                                            if (e.target.value) setErrors(p => ({ ...p, skills_to_improve: '' })); // Clear list error if other typed
                                        }}
                                        className="max-w-xs"
                                    />
                                </div>
                                {errors.skills_to_improve && <p className="text-sm text-red-500">{errors.skills_to_improve}</p>}
                            </div>
                        </div>
                    </Section>

                    {/* 4. Requirements */}
                    <Section title="4. Requirements & Challenges">
                        <div className="space-y-4">
                            <Label ref={setRef('resources_needed')} className={errors.resources_needed ? "text-red-500" : ""}>Rate your need (High / Medium / Low) for ALL items *</Label>
                            <div className="grid gap-4 bg-gray-50 p-4 rounded-lg">
                                {[
                                    "Manpower",
                                    "Storage space",
                                    "Work space / workshop",
                                    "Packaging equipment",
                                    "Marketing support",
                                    "Sales channels",
                                    "Financial support",
                                    "Digital tools",
                                    "Packaging & quality certification",
                                    "Transport & Logistics"
                                ].map(res => (
                                    <div key={res} className="grid grid-cols-1 md:grid-cols-2 items-center gap-2">
                                        <span className={cn("text-sm font-medium", !resourceRatings[res] && errors.resources_needed && "text-red-600")}>{res}</span>
                                        <RadioGroup
                                            value={resourceRatings[res] || ''}
                                            onValueChange={v => handleResourceRatingChange(res, v)}
                                            className="flex gap-4"
                                        >
                                            {['High', 'Medium', 'Low'].map(rating => (
                                                <div key={rating} className="flex items-center space-x-1">
                                                    <RadioGroupItem value={rating} id={`res-${res}-${rating}`} />
                                                    <Label htmlFor={`res-${res}-${rating}`} className="text-sm font-normal">{rating}</Label>
                                                </div>
                                            ))}
                                        </RadioGroup>
                                    </div>
                                ))}
                            </div>
                            {errors.resources_needed && <p className="text-sm text-red-500 flex items-center gap-2"><AlertCircle className="h-4 w-4" /> {errors.resources_needed}</p>}

                            <div className="space-y-2">
                                <Label>Challenges you face</Label>
                                <Textarea
                                    value={formData.challenges}
                                    onChange={e => setFormData({ ...formData, challenges: e.target.value })}
                                    placeholder="Describe any challenges..."
                                />
                            </div>
                        </div>
                    </Section>

                    {/* 5. Sales */}
                    <Section title="5. Sales & Market">
                        <div className="space-y-6">
                            <div className="space-y-3" ref={setRef('sales_channels')}>
                                <Label className={errors.sales_channels ? "text-red-500" : ""}>Where do you currently sell your products? *</Label>
                                <div className="grid md:grid-cols-2 gap-4">
                                    {[
                                        "Local markets",
                                        "Weekly markets",
                                        "Online (ONDC / other platform)",
                                        "Shops / consignments",
                                        "Direct to customers"
                                    ].map(chan => (
                                        <div key={chan} className="flex items-center space-x-2">
                                            <Checkbox
                                                id={`chan-${chan}`}
                                                checked={formData.sales_channels.includes(chan)}
                                                onCheckedChange={(c) => handleCheckboxChange('sales_channels', chan, c as boolean)}
                                            />
                                            <Label htmlFor={`chan-${chan}`} className="font-normal">{chan}</Label>
                                        </div>
                                    ))}
                                </div>
                                <div className="flex items-center space-x-2 mt-2">
                                    <Label>Other:</Label>
                                    <Input
                                        value={formData.sales_other}
                                        onChange={e => {
                                            setFormData({ ...formData, sales_other: e.target.value });
                                            if (e.target.value) setErrors(p => ({ ...p, sales_channels: '' }));
                                        }}
                                        className="max-w-xs"
                                    />
                                </div>
                                {errors.sales_channels && <p className="text-sm text-red-500">{errors.sales_channels}</p>}
                            </div>

                            <div className="space-y-3" ref={setRef('selling_difficulty')}>
                                <Label className={errors.selling_difficulty ? "text-red-500" : ""}>Do you face difficulties in selling your products? *</Label>
                                <RadioGroup
                                    value={formData.selling_difficulty === true ? "yes" : (formData.selling_difficulty === false ? "no" : "")}
                                    onValueChange={v => {
                                        setFormData({ ...formData, selling_difficulty: v === "yes" });
                                        setErrors(p => ({ ...p, selling_difficulty: '' }));
                                    }}
                                >
                                    <div className="flex items-center space-x-2">
                                        <RadioGroupItem value="yes" id="diff-yes" />
                                        <Label htmlFor="diff-yes">Yes</Label>
                                    </div>
                                    <div className="flex items-center space-x-2">
                                        <RadioGroupItem value="no" id="diff-no" />
                                        <Label htmlFor="diff-no">No</Label>
                                    </div>
                                </RadioGroup>
                                {errors.selling_difficulty && <p className="text-sm text-red-500">{errors.selling_difficulty}</p>}

                                {formData.selling_difficulty === true && (
                                    <div className="mt-2" ref={setRef('selling_difficulty_details')}>
                                        <Textarea
                                            placeholder="What are the difficulties?"
                                            value={formData.selling_difficulty_details}
                                            onChange={e => {
                                                setFormData({ ...formData, selling_difficulty_details: e.target.value });
                                                if (e.target.value) setErrors(p => ({ ...p, selling_difficulty_details: '' }));
                                            }}
                                            className={errors.selling_difficulty_details ? "border-red-500" : ""}
                                        />
                                        {errors.selling_difficulty_details && <p className="text-sm text-red-500">{errors.selling_difficulty_details}</p>}
                                    </div>
                                )}
                            </div>
                        </div>
                    </Section>

                    {/* 6. Support & Future */}
                    <Section title="6. Future Plans & Support">
                        <div className="space-y-6">
                            <div className="space-y-3" ref={setRef('support_needed')}>
                                <Label className={errors.support_needed ? "text-red-500" : ""}>Would you like support in: *</Label>
                                <div className="grid md:grid-cols-2 gap-4">
                                    {[
                                        "Branding",
                                        "Packaging design",
                                        "Digital marketing",
                                        "Sales network expansion",
                                        "Participation in exhibitions/fairs",
                                        "Pricing strategy",
                                        "Online sales"
                                    ].map(item => (
                                        <div key={item} className="flex items-center space-x-2">
                                            <Checkbox
                                                id={`sup-${item}`}
                                                checked={formData.support_needed.includes(item)}
                                                onCheckedChange={(c) => handleCheckboxChange('support_needed', item, c as boolean)}
                                            />
                                            <Label htmlFor={`sup-${item}`} className="font-normal">{item}</Label>
                                        </div>
                                    ))}
                                </div>
                                <div className="flex items-center space-x-2 mt-2">
                                    <Label>Other:</Label>
                                    <Input
                                        value={formData.support_other}
                                        onChange={e => {
                                            setFormData({ ...formData, support_other: e.target.value });
                                            if (e.target.value) setErrors(p => ({ ...p, support_needed: '' }));
                                        }}
                                        className="max-w-xs"
                                    />
                                </div>
                                {errors.support_needed && <p className="text-sm text-red-500">{errors.support_needed}</p>}
                            </div>

                            <div className="space-y-3" ref={setRef('growth_plans')}>
                                <Label className={errors.growth_plans ? "text-red-500" : ""}>How would you like to grow your livelihood in 2–3 years? *</Label>
                                <div className="grid md:grid-cols-2 gap-4">
                                    {[
                                        "Increase monthly income",
                                        "Expand production",
                                        "Start a new product/service",
                                        "Employ more people",
                                        "Sell outside my locality/district/state",
                                        "Go digital / online sales",
                                        "Build a brand",
                                        "Become a trainer/mentor",
                                        "Not sure yet"
                                    ].map(plan => (
                                        <div key={plan} className="flex items-center space-x-2">
                                            <Checkbox
                                                id={`plan-${plan}`}
                                                checked={formData.growth_plans.includes(plan)}
                                                onCheckedChange={(c) => handleCheckboxChange('growth_plans', plan, c as boolean)}
                                            />
                                            <Label htmlFor={`plan-${plan}`} className="font-normal">{plan}</Label>
                                        </div>
                                    ))}
                                </div>
                                {errors.growth_plans && <p className="text-sm text-red-500">{errors.growth_plans}</p>}
                            </div>

                            <div className="space-y-3" ref={setRef('mobile_usage')}>
                                <Label className={errors.mobile_usage ? "text-red-500" : ""}>How do you currently use mobile/social media? *</Label>
                                <div className="grid md:grid-cols-1 gap-4">
                                    {[
                                        "I do not use social media for work",
                                        "WhatsApp (customer orders, groups, photos)",
                                        "Facebook (posting products / pages)",
                                        "Instagram (reels, product photos)",
                                        "YouTube (learning skills / watching tutorials)",
                                        "Online platforms (ONDC, marketplaces, apps)",
                                        "I want to use social media but don’t know how"
                                    ].map(use => (
                                        <div key={use} className="flex items-center space-x-2">
                                            <Checkbox
                                                id={`mob-${use}`}
                                                checked={formData.mobile_usage.includes(use)}
                                                onCheckedChange={(c) => handleCheckboxChange('mobile_usage', use, c as boolean)}
                                            />
                                            <Label htmlFor={`mob-${use}`} className="font-normal">{use}</Label>
                                        </div>
                                    ))}
                                </div>
                                <div className="flex items-center space-x-2 mt-2">
                                    <Label>Other:</Label>
                                    <Input
                                        value={formData.mobile_usage_other}
                                        onChange={e => {
                                            setFormData({ ...formData, mobile_usage_other: e.target.value });
                                            if (e.target.value) setErrors(p => ({ ...p, mobile_usage: '' }));
                                        }}
                                        className="max-w-xs"
                                    />
                                </div>
                                {errors.mobile_usage && <p className="text-sm text-red-500">{errors.mobile_usage}</p>}
                            </div>
                        </div>
                    </Section>

                    <Button size="lg" className="w-full text-lg" disabled={isSubmitting}>
                        {isSubmitting ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Submitting...
                            </>
                        ) : 'Submit Questionnaire'}
                    </Button>

                </fieldset>
            </form>
        </div>
    );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <SlideIn delay={0.1}>
            <Card className="border-gray-100 shadow-sm mb-6">
                <CardHeader>
                    <CardTitle>{title}</CardTitle>
                </CardHeader>
                <CardContent>{children}</CardContent>
            </Card>
        </SlideIn>
    );
}
