'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { FadeIn } from '@/components/animations/FadeIn';
import { SlideIn } from '@/components/animations/SlideIn';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { motion } from 'framer-motion';
import { UserPlus, Save, User } from 'lucide-react';
import { authHelpers, UserRole, databases, DATABASE_ID, COLLECTIONS } from '@/lib/appwrite';
import { Query } from 'appwrite';

interface Member {
  fullName: string;
  email: string;
  phone: string;
  gender: string;
  role: string;
}

export default function TeamRegistrationPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [userId, setUserId] = useState('');

  // Team Lead Details
  const [leadName, setLeadName] = useState('');
  const [leadEmail, setLeadEmail] = useState('');
  const [leadPhone, setLeadPhone] = useState('');
  const [leadGender, setLeadGender] = useState('');
  const [leadRole, setLeadRole] = useState('');

  // Team Details
  const [teamName, setTeamName] = useState('');
  const [members, setMembers] = useState<Member[]>([
    { fullName: '', email: '', phone: '', gender: '', role: '' },
  ]);
  const [isEditing, setIsEditing] = useState(false);
  const [isApproved, setIsApproved] = useState(false);

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
      setLeadName(user.name);
      setLeadEmail(user.email);

      // Fetch existing team data
      try {
        const teamsResponse = await databases.listDocuments(
          DATABASE_ID,
          COLLECTIONS.TEAMS,
          [Query.equal('leader_user_id', user.$id)]
        );

        if (teamsResponse.total > 0) {
          const team = teamsResponse.documents[0] as any;

          // Pre-fill team information if exists
          if (team.teamName) {
            setTeamName(team.teamName || '');
            setIsEditing(true);
            setIsApproved(team.status === 'registered');

            // Fetch existing members including lead
            try {
              const membersResponse = await databases.listDocuments(
                DATABASE_ID,
                COLLECTIONS.MEMBERS,
                [Query.equal('team_id', team.$id)]
              );

              if (membersResponse.total > 0) {
                const allMembers = membersResponse.documents.map((doc: any) => ({
                  fullName: doc.full_name || '',
                  email: doc.email || '',
                  phone: doc.phone || '',
                  gender: doc.gender || '',
                  role: doc.role || ''
                }));

                // Separate Lead from other members based on email
                const leadMember = allMembers.find(m => m.email.toLowerCase() === user.email.toLowerCase());
                const otherMembers = allMembers.filter(m => m.email.toLowerCase() !== user.email.toLowerCase());

                if (leadMember) {
                  setLeadPhone(leadMember.phone);
                  setLeadGender(leadMember.gender);
                  setLeadRole(leadMember.role);
                }

                if (otherMembers.length > 0) {
                  setMembers(otherMembers);
                } else {
                  // Start effectively with empty if no other members found (shouldn't really happen if logic requires 1 member, but safety first)
                  if (allMembers.length === 0 && !leadMember) {
                    setMembers([{ fullName: '', email: '', phone: '', gender: '', role: '' }]);
                  } else if (otherMembers.length === 0) {
                    // If only lead is there, we need at least one member slot focused (or maybe allow 0 if logic changed? No, request implies 1-5 members excluding lead)
                    // Actually, user said 1-5 members. Let's keep existing logic.
                    setMembers([{ fullName: '', email: '', phone: '', gender: '', role: '' }]);
                  }
                }
              }
            } catch (error) {
              console.error('Error fetching members:', error);
            }
          }
        }
      } catch (error) {
        console.error('Error fetching team data:', error);
      }

      setIsLoading(false);
    };
    checkAuth();
  }, [router]);

  const handleMemberChange = (index: number, field: string, value: string) => {
    const newMembers = [...members];
    newMembers[index] = { ...newMembers[index], [field]: value };
    setMembers(newMembers);
  };

  const addMember = () => {
    if (members.length < 5) {
      setMembers([...members, { fullName: '', email: '', phone: '', gender: '', role: '' }]);
    }
  };

  const removeMember = (index: number) => {
    if (members.length > 1) {
      setMembers(members.filter((_, i) => i !== index));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isApproved) {
      alert('Your team has been approved by the campus lead. You cannot edit the data. Please contact your campus lead if changes are needed.');
      return;
    }

    setIsSubmitting(true);

    try {
      // Validate Lead Details
      if (!leadPhone || !leadGender || !leadRole) {
        alert('Please fill in all team lead details');
        setIsSubmitting(false);
        return;
      }

      // Validate member count (1-5 excluding lead)
      if (members.length < 1 || members.length > 5) {
        alert('Team must have between 1 and 5 members (excluding Team Lead)');
        setIsSubmitting(false);
        return;
      }

      // Validate all members have data
      const invalidMember = members.find(
        m => !m.fullName || !m.email || !m.phone || !m.gender || !m.role
      );

      if (invalidMember) {
        alert('Please fill in all member details');
        setIsSubmitting(false);
        return;
      }

      const response = await fetch('/api/team/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include', // Include cookies with the request
        body: JSON.stringify({
          userId,
          teamName,
          teamLeadPhone: leadPhone,
          teamLeadGender: leadGender,
          teamLeadRole: leadRole,
          members,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to register team');
      }

      alert(isEditing ? 'Team updated successfully!' : 'Team registered successfully!');
      router.push('/team/dashboard');
    } catch (error: any) {
      console.error('Error registering team:', error);
      alert(error.message || 'Failed to register team. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-6 py-12">
      <FadeIn>
        <div className="max-w-4xl mx-auto space-y-2 mb-8">
          <h1 className="text-3xl font-bold tracking-tight">
            {isApproved ? 'Team Registration (Approved)' : (isEditing ? 'Update Team Registration' : 'Team Registration')}
          </h1>
          <p className="text-gray-600">
            {isApproved
              ? 'Your team has been approved by the campus lead. Contact them for any changes.'
              : (isEditing
                ? 'Update your team details for Vision Hack 2026'
                : 'Register your team for Vision Hack 2026')}
          </p>
          {isApproved && (
            <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-sm text-green-800">
                <strong>✓ Approved:</strong> Your team registration has been approved. All fields are locked. Contact your campus lead if you need to make changes.
              </p>
            </div>
          )}
        </div>
      </FadeIn>

      <form onSubmit={handleSubmit} className="max-w-4xl mx-auto space-y-6">
        <SlideIn delay={0.2}>
          <Card className="border-gray-100">
            <CardHeader>
              <CardTitle>Team Lead Information</CardTitle>
              <CardDescription>Your personal details</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="teamName">Team Name</Label>
                <Input
                  id="teamName"
                  placeholder="Enter your team name"
                  value={teamName}
                  onChange={(e) => setTeamName(e.target.value)}
                  disabled={isApproved}
                  required
                />
              </div>
              <Separator className="my-2" />
              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Full Name</Label>
                  <Input
                    value={leadName}
                    disabled={true}
                    className="bg-gray-50"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input
                    value={leadEmail}
                    disabled={true}
                    className="bg-gray-50"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="leadPhone">Phone</Label>
                  <Input
                    id="leadPhone"
                    placeholder="+91 1234567890"
                    value={leadPhone}
                    onChange={(e) => setLeadPhone(e.target.value)}
                    disabled={isApproved}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="leadGender">Gender</Label>
                  <Select
                    value={leadGender}
                    onValueChange={setLeadGender}
                    disabled={isApproved}
                  >
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
                  <Label htmlFor="leadRole">Role</Label>
                  <Input
                    id="leadRole"
                    placeholder="e.g., Team Lead, Full Stack Developer"
                    value={leadRole}
                    onChange={(e) => setLeadRole(e.target.value)}
                    disabled={isApproved}
                    required
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </SlideIn>

        <SlideIn delay={0.3}>
          <Card className="border-gray-100">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center">
                  <UserPlus className="mr-2 h-5 w-5" />
                  Team Members ({members.length})
                </div>
                {members.length < 5 && !isApproved && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addMember}
                  >
                    <UserPlus className="mr-2 h-4 w-4" />
                    Add Member
                  </Button>
                )}
              </CardTitle>
              <CardDescription>Add 1-5 team members (excluding team leader)</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {members.map((member, index) => (
                <div key={index}>
                  <FadeIn delay={0.4 + index * 0.1}>
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <h3 className="font-semibold text-sm text-gray-700">
                          Member {index + 1}
                        </h3>
                        {members.length > 1 && !isApproved && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removeMember(index)}
                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                          >
                            Remove
                          </Button>
                        )}
                      </div>

                      <div className="grid md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>Full Name</Label>
                          <Input
                            placeholder="Full name"
                            value={member.fullName}
                            onChange={(e) => handleMemberChange(index, 'fullName', e.target.value)}
                            disabled={isApproved}
                            required
                          />
                        </div>

                        <div className="space-y-2">
                          <Label>Email</Label>
                          <Input
                            type="email"
                            placeholder="email@example.com"
                            value={member.email}
                            onChange={(e) => handleMemberChange(index, 'email', e.target.value)}
                            disabled={isApproved}
                            required
                          />
                        </div>

                        <div className="space-y-2">
                          <Label>Phone</Label>
                          <Input
                            placeholder="+91 1234567890"
                            value={member.phone}
                            onChange={(e) => handleMemberChange(index, 'phone', e.target.value)}
                            disabled={isApproved}
                            required
                          />
                        </div>

                        <div className="space-y-2">
                          <Label>Gender</Label>
                          <Select
                            value={member.gender}
                            onValueChange={(value) => handleMemberChange(index, 'gender', value)}
                            disabled={isApproved}
                          >
                            <SelectTrigger>
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
                          <Label>Role</Label>
                          <Input
                            placeholder="e.g., Developer, Designer, Manager"
                            value={member.role}
                            onChange={(e) => handleMemberChange(index, 'role', e.target.value)}
                            disabled={isApproved}
                            required
                          />
                        </div>
                      </div>
                    </div>
                  </FadeIn>
                  {index < members.length - 1 && <Separator className="mt-6" />}
                </div>
              ))}
            </CardContent>
          </Card>
        </SlideIn>

        <FadeIn delay={0.8}>
          <motion.div whileHover={{ scale: isApproved ? 1 : 1.01 }} whileTap={{ scale: isApproved ? 1 : 0.99 }}>
            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={isSubmitting || isApproved}
            >
              <Save className="mr-2 h-4 w-4" />
              {isApproved
                ? '✓ Approved - Contact Campus Lead for Changes'
                : (isSubmitting
                  ? (isEditing ? 'Updating...' : 'Registering...')
                  : (isEditing ? 'Update Team' : 'Register Team'))}
            </Button>
          </motion.div>
        </FadeIn>
      </form>
    </div>
  );
}
