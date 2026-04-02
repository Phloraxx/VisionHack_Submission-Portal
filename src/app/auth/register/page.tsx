"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { FadeIn } from "@/components/animations/FadeIn";
import { SlideIn } from "@/components/animations/SlideIn";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { InstitutionSelector } from "@/components/ui/institution-selector";
import { motion } from "framer-motion";
import { UserPlus, Save, ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface Member {
  fullName: string;
  email: string;
  phone: string;
  gender: string;
  role: string;
}

interface Institution {
  id: string;
  name: string;
  district: string;
}

export default function RegisterPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Institution data
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [selectedInstitution, setSelectedInstitution] = useState("");
  const [institutionSearch, setInstitutionSearch] = useState("");

  // Team Lead Details
  const [leadName, setLeadName] = useState("");
  const [leadEmail, setLeadEmail] = useState("");
  const [leadPhone, setLeadPhone] = useState("");
  const [leadGender, setLeadGender] = useState("");
  const [leadRole, setLeadRole] = useState("");

  // Team Details
  const [teamName, setTeamName] = useState("");
  const [members, setMembers] = useState<Member[]>([
    { fullName: "", email: "", phone: "", gender: "", role: "" },
  ]);

  // Fetch institutions
  useEffect(() => {
    const fetchInstitutions = async () => {
      setIsLoading(true);
      try {
        const response = await fetch("/api/institutions/list");
        const data = await response.json();
        if (data.success) {
          setInstitutions(data.institutions);
        } else {
          toast.error("Failed to load institutions");
        }
      } catch (error) {
        console.error("Error fetching institutions:", error);
        toast.error("Failed to load institutions");
      } finally {
        setIsLoading(false);
      }
    };
    fetchInstitutions();
  }, []);

  const handleMemberChange = (index: number, field: string, value: string) => {
    const newMembers = [...members];
    newMembers[index] = { ...newMembers[index], [field]: value };
    setMembers(newMembers);
  };

  const addMember = () => {
    if (members.length < 5) {
      setMembers([...members, { fullName: "", email: "", phone: "", gender: "", role: "" }]);
    }
  };

  const removeMember = (index: number) => {
    if (members.length > 0) {
      setMembers(members.filter((_, i) => i !== index));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validation
    if (!selectedInstitution) {
      toast.error("Please select an institution");
      return;
    }

    if (!teamName.trim()) {
      toast.error("Team name is required");
      return;
    }

    if (!leadName.trim() || !leadEmail.trim() || !leadPhone.trim() || !leadGender || !leadRole.trim()) {
      toast.error("Please fill in all team lead details");
      return;
    }

    // Validate member count
    if (members.length > 5) {
      toast.error("Maximum 5 team members allowed (excluding team leader)");
      return;
    }

    // If there are members, validate them
    if (members.length > 0) {
      const invalidMember = members.find(
        (m) => !m.fullName || !m.email || !m.phone || !m.gender || !m.role
      );

      if (invalidMember) {
        toast.error("Please fill in all member details or remove empty members");
        return;
      }
    }

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/team/public-register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          institutionId: selectedInstitution,
          teamName,
          teamLeadName: leadName,
          teamLeadEmail: leadEmail,
          teamLeadPhone: leadPhone,
          teamLeadGender: leadGender,
          teamLeadRole: leadRole,
          members: members.filter((m) => m.fullName && m.email), // Only send filled members
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 403) {
          toast.error(data.message || "Registration is currently closed");
        } else {
          throw new Error(data.error || "Failed to register team");
        }
        return;
      }

      toast.success("🎉 Registration successful! Please check your email for login credentials to access your dashboard.");
      
      // Reset form
      setSelectedInstitution("");
      setTeamName("");
      setLeadName("");
      setLeadEmail("");
      setLeadPhone("");
      setLeadGender("");
      setLeadRole("");
      setMembers([{ fullName: "", email: "", phone: "", gender: "", role: "" }]);
      setInstitutionSearch("");

      // Show success message with team code
      setTimeout(() => {
        toast.info(`Your team code is: ${data.data?.team?.teamCode || "N/A"}. Save this for future reference.`);
      }, 1000);

      // Redirect to login after 2 seconds
      setTimeout(() => {
        router.push("/");
      }, 3000);

    } catch (error: any) {
      console.error("Error registering team:", error);
      toast.error(error.message || "Failed to register team. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
      {/* Header */}
      <div className="bg-white border-b shadow-sm sticky top-0 z-10">
        <div className="container mx-auto px-6 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Vision Hack 2026</h1>
            <p className="text-sm text-gray-600">Team Registration</p>
          </div>
          <Button
            variant="outline"
            asChild
          >
            <Link href="/">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Login
            </Link>
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-6 py-12">
        <FadeIn>
          <div className="max-w-4xl mx-auto space-y-4 mb-8 text-center">
            <h2 className="text-3xl font-bold tracking-tight">Register Your Team</h2>
            <p className="text-gray-600">
              Join Vision Hack 2026 by registering your team.
            </p>
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm text-blue-800 font-medium">
                📧 After registration, you will receive your login credentials via email to access your dashboard.
              </p>
            </div>
          </div>
        </FadeIn>

        <form onSubmit={handleSubmit} className="max-w-4xl mx-auto space-y-6">
          {/* Institution Selection */}
          <SlideIn delay={0.1}>
            <Card className="border-gray-100">
              <CardHeader>
                <CardTitle>Select Your Institution</CardTitle>
                <CardDescription>Choose your college or university from the list</CardDescription>
              </CardHeader>
              <CardContent>
                <InstitutionSelector
                  institutions={institutions}
                  selectedInstitution={selectedInstitution}
                  onSelectInstitution={setSelectedInstitution}
                  searchQuery={institutionSearch}
                  onSearchChange={setInstitutionSearch}
                  isLoading={isLoading}
                />
              </CardContent>
            </Card>
          </SlideIn>

          {/* Team Lead Information */}
          <SlideIn delay={0.2}>
            <Card className="border-gray-100">
              <CardHeader>
                <CardTitle>Team Lead Information</CardTitle>
                <CardDescription>Enter your personal details as the team leader</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="teamName">Team Name *</Label>
                  <Input
                    id="teamName"
                    placeholder="Enter your team name"
                    value={teamName}
                    onChange={(e) => setTeamName(e.target.value)}
                    required
                  />
                </div>
                <Separator className="my-2" />
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="leadName">Full Name *</Label>
                    <Input
                      id="leadName"
                      placeholder="Your full name"
                      value={leadName}
                      onChange={(e) => setLeadName(e.target.value)}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="leadEmail">Email *</Label>
                    <Input
                      id="leadEmail"
                      type="email"
                      placeholder="your.email@example.com"
                      value={leadEmail}
                      onChange={(e) => setLeadEmail(e.target.value)}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="leadPhone">Phone *</Label>
                    <Input
                      id="leadPhone"
                      placeholder="+91 1234567890"
                      value={leadPhone}
                      onChange={(e) => setLeadPhone(e.target.value)}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="leadGender">Gender *</Label>
                    <Select value={leadGender} onValueChange={setLeadGender} required>
                      <SelectTrigger id="leadGender">
                        <SelectValue placeholder="Select gender" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Male">Male</SelectItem>
                        <SelectItem value="Female">Female</SelectItem>
                        <SelectItem value="Other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="leadRole">Role *</Label>
                    <Input
                      id="leadRole"
                      placeholder="e.g., Team Lead, Full Stack Developer"
                      value={leadRole}
                      onChange={(e) => setLeadRole(e.target.value)}
                      required
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </SlideIn>

          {/* Team Members */}
          <SlideIn delay={0.3}>
            <Card className="border-gray-100">
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <div className="flex items-center">
                    <UserPlus className="mr-2 h-5 w-5" />
                    Team Members ({members.length})
                  </div>
                  {members.length < 5 && (
                    <Button type="button" variant="outline" size="sm" onClick={addMember}>
                      <UserPlus className="mr-2 h-4 w-4" />
                      Add Member
                    </Button>
                  )}
                </CardTitle>
                <CardDescription>
                  Add up to 5 team members (excluding team leader). You can register alone or with team members.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {members.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <p>No team members added. Click &quot;Add Member&quot; to add team members.</p>
                    <p className="text-sm mt-2">You can also register alone as a team of one.</p>
                  </div>
                ) : (
                  members.map((member, index) => (
                    <div key={index}>
                      <FadeIn delay={0.4 + index * 0.1}>
                        <div className="space-y-4">
                          <div className="flex items-center justify-between">
                            <h3 className="font-semibold text-sm text-gray-700">Member {index + 1}</h3>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => removeMember(index)}
                              className="text-red-600 hover:text-red-700 hover:bg-red-50"
                              aria-label={`Remove Member ${index + 1}`}
                            >
                              Remove
                            </Button>
                          </div>

                          <div className="grid md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <Label htmlFor={`member-${index}-fullName`}>Full Name *</Label>
                              <Input
                                id={`member-${index}-fullName`}
                                placeholder="Full name"
                                value={member.fullName}
                                onChange={(e) => handleMemberChange(index, "fullName", e.target.value)}
                                required
                              />
                            </div>

                            <div className="space-y-2">
                              <Label htmlFor={`member-${index}-email`}>Email *</Label>
                              <Input
                                id={`member-${index}-email`}
                                type="email"
                                placeholder="email@example.com"
                                value={member.email}
                                onChange={(e) => handleMemberChange(index, "email", e.target.value)}
                                required
                              />
                            </div>

                            <div className="space-y-2">
                              <Label htmlFor={`member-${index}-phone`}>Phone *</Label>
                              <Input
                                id={`member-${index}-phone`}
                                placeholder="+91 1234567890"
                                value={member.phone}
                                onChange={(e) => handleMemberChange(index, "phone", e.target.value)}
                                required
                              />
                            </div>

                            <div className="space-y-2">
                              <Label htmlFor={`member-${index}-gender`}>Gender *</Label>
                              <Select
                                value={member.gender}
                                onValueChange={(value) => handleMemberChange(index, "gender", value)}
                                required
                              >
                                <SelectTrigger id={`member-${index}-gender`}>
                                  <SelectValue placeholder="Select gender" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="Male">Male</SelectItem>
                                  <SelectItem value="Female">Female</SelectItem>
                                  <SelectItem value="Other">Other</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>

                            <div className="space-y-2 md:col-span-2">
                              <Label htmlFor={`member-${index}-role`}>Role *</Label>
                              <Input
                                id={`member-${index}-role`}
                                placeholder="e.g., Developer, Designer, Manager"
                                value={member.role}
                                onChange={(e) => handleMemberChange(index, "role", e.target.value)}
                                required
                              />
                            </div>
                          </div>
                        </div>
                      </FadeIn>
                      {index < members.length - 1 && <Separator className="mt-6" />}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </SlideIn>

          {/* Submit Button */}
          <FadeIn delay={0.8}>
            <motion.div whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }}>
              <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                {isSubmitting ? "Registering..." : "Register Team"}
              </Button>
            </motion.div>
          </FadeIn>

          {/* Info Footer */}
          <div className="text-center text-sm text-gray-500 space-y-2">
            <p className="font-medium text-gray-700">📧 Important: Login credentials will be sent to the team lead&apos;s email address after registration.</p>
            <p>Please check your inbox and spam folder for the credentials email.</p>
            <p>
              Already registered?{" "}
              <Link
                href="/"
                className="text-blue-600 hover:underline"
              >
                Login here
              </Link>
            </p>
          </div>
        </form>
      </div>
    </div>
  );
}
