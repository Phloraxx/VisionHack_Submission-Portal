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
import { UserPlus, Save } from 'lucide-react';
import { authHelpers, UserRole } from '@/lib/appwrite';

export default function TeamRegistrationPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [teamName, setTeamName] = useState('');
  const [members, setMembers] = useState([
    { fullName: '', email: '', phone: '', gender: '', role: '' },
    { fullName: '', email: '', phone: '', gender: '', role: '' },
    { fullName: '', email: '', phone: '', gender: '', role: '' },
    { fullName: '', email: '', phone: '', gender: '', role: '' },
  ]);

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
      setIsLoading(false);
    };
    checkAuth();
  }, [router]);

  const handleMemberChange = (index: number, field: string, value: string) => {
    const newMembers = [...members];
    newMembers[index] = { ...newMembers[index], [field]: value };
    setMembers(newMembers);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // TODO: Implement team registration with Appwrite
    console.log('Team registration:', { teamName, members });
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
          <h1 className="text-3xl font-bold tracking-tight">Team Registration</h1>
          <p className="text-gray-600">Register your team for Vision Hack 2026</p>
        </div>
      </FadeIn>

      <form onSubmit={handleSubmit} className="max-w-4xl mx-auto space-y-6">
        <SlideIn delay={0.2}>
          <Card className="border-gray-100">
            <CardHeader>
              <CardTitle>Team Information</CardTitle>
              <CardDescription>Basic details about your team</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <Label htmlFor="teamName">Team Name</Label>
                <Input
                  id="teamName"
                  placeholder="Enter your team name"
                  value={teamName}
                  onChange={(e) => setTeamName(e.target.value)}
                  required
                />
              </div>
            </CardContent>
          </Card>
        </SlideIn>

        <SlideIn delay={0.3}>
          <Card className="border-gray-100">
            <CardHeader>
              <CardTitle className="flex items-center">
                <UserPlus className="mr-2 h-5 w-5" />
                Team Members
              </CardTitle>
              <CardDescription>Add 4 team members (excluding team leader)</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {members.map((member, index) => (
                <div key={index}>
                  <FadeIn delay={0.4 + index * 0.1}>
                    <div className="space-y-4">
                      <h3 className="font-semibold text-sm text-gray-700">
                        Member {index + 1}
                      </h3>
                      
                      <div className="grid md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>Full Name</Label>
                          <Input
                            placeholder="Full name"
                            value={member.fullName}
                            onChange={(e) => handleMemberChange(index, 'fullName', e.target.value)}
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
                            required
                          />
                        </div>

                        <div className="space-y-2">
                          <Label>Phone</Label>
                          <Input
                            placeholder="+91 1234567890"
                            value={member.phone}
                            onChange={(e) => handleMemberChange(index, 'phone', e.target.value)}
                            required
                          />
                        </div>

                        <div className="space-y-2">
                          <Label>Gender</Label>
                          <Select onValueChange={(value) => handleMemberChange(index, 'gender', value)}>
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
          <motion.div whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }}>
            <Button type="submit" size="lg" className="w-full">
              <Save className="mr-2 h-4 w-4" />
              Register Team
            </Button>
          </motion.div>
        </FadeIn>
      </form>
    </div>
  );
}
