// src/app/admin/teams/page.tsx - Admin Teams Management
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FadeIn } from '@/components/animations/FadeIn';
import { SlideIn } from '@/components/animations/SlideIn';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { authHelpers, UserRole, databases, DATABASE_ID, COLLECTIONS } from '@/lib/appwrite';
import { Search, Building2, MapPin, Users, Mail, Phone, ArrowLeft, Edit2, Save, X, Trash2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { Query } from 'appwrite';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/components/ui/select';

interface TeamMember {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  gender: string;
  role: string;
}

interface Team {
  id: string;
  teamName: string;
  institutionName: string;
  institutionId: string;
  district: string;
  status: string;
  teamCode: string;
  teamLeadName: string;
  teamLeadEmail: string;
  ideaTitle: string;
  ideaDesc: string;
  techStack: string;
  members: TeamMember[];
  createdAt: string;
}

export default function AdminTeamsPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [isFetching, setIsFetching] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [districtFilter, setDistrictFilter] = useState<string>('all');
  const [teams, setTeams] = useState<Team[]>([]);
  const [editingTeam, setEditingTeam] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<Team>>({});
  const [editingMember, setEditingMember] = useState<string | null>(null);
  const [editMemberData, setEditMemberData] = useState<Partial<TeamMember>>({});

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
      setIsLoading(false);
      await fetchTeams();
    };
    checkAuth();
  }, [router]);

  const fetchTeams = async () => {
    setIsFetching(true);
    try {
      // Fetch all teams
      const teamsResponse = await databases.listDocuments(
        DATABASE_ID,
        COLLECTIONS.TEAMS,
        [Query.orderDesc('$createdAt'), Query.limit(500)]
      );

      // Fetch all institutions
      const institutionsResponse = await databases.listDocuments(
        DATABASE_ID,
        COLLECTIONS.INSTITUTIONS,
        [Query.limit(500)]
      );

      const institutionsMap = new Map(
        institutionsResponse.documents.map((inst: any) => [
          inst.$id,
          { name: inst.name, district: inst.district || 'Unknown' }
        ])
      );

      // Fetch members for all teams
      const membersResponse = await databases.listDocuments(
        DATABASE_ID,
        COLLECTIONS.MEMBERS,
        [Query.limit(5000)]
      );

      const membersByTeam = membersResponse.documents.reduce((acc: any, member: any) => {
        if (!acc[member.team_id]) {
          acc[member.team_id] = [];
        }
        acc[member.team_id].push({
          id: member.$id,
          fullName: member.full_name,
          email: member.email,
          phone: member.phone,
          gender: member.gender,
          role: member.role,
        });
        return acc;
      }, {});

      const teamsData = teamsResponse.documents.map((team: any) => {
        const institution = institutionsMap.get(team.institution_id);
        return {
          id: team.$id,
          teamName: team.teamName || team.name || 'Unnamed Team',
          institutionName: institution?.name || 'Unknown Institution',
          institutionId: team.institution_id,
          district: institution?.district || 'Unknown',
          status: team.status || 'waitlisted',
          teamCode: team.team_code || '',
          teamLeadName: team.teamLeadName || '',
          teamLeadEmail: team.teamLeadEmail || '',
          ideaTitle: team.idea_title || '',
          ideaDesc: team.idea_desc || '',
          techStack: team.idea_tech_stack || '',
          members: membersByTeam[team.$id] || [],
          createdAt: team.$createdAt,
        };
      });

      setTeams(teamsData);
    } catch (error: any) {
      console.error('Error fetching teams:', error);
      toast.error('Failed to load teams');
    } finally {
      setIsFetching(false);
    }
  };

  const handleEdit = (team: Team) => {
    setEditingTeam(team.id);
    setEditData({
      teamName: team.teamName,
      status: team.status,
      teamLeadName: team.teamLeadName,
      teamLeadEmail: team.teamLeadEmail,
      district: team.district,
      teamCode: team.teamCode,
    });
  };

  const handleSave = async (teamId: string) => {
    try {
      // Get the team to update institution if district changed
      const team = teams.find(t => t.id === teamId);
      const updateData: any = {
        teamName: editData.teamName,
        status: editData.status,
        teamLeadName: editData.teamLeadName,
        teamLeadEmail: editData.teamLeadEmail,
        team_code: editData.teamCode,
      };

      await databases.updateDocument(
        DATABASE_ID,
        COLLECTIONS.TEAMS,
        teamId,
        updateData
      );

      // Update institution district if changed
      if (team && editData.district !== team.district) {
        try {
          await databases.updateDocument(
            DATABASE_ID,
            COLLECTIONS.INSTITUTIONS,
            team.institutionId,
            { district: editData.district }
          );
        } catch (error) {
          console.error('Error updating institution district:', error);
        }
      }

      toast.success('Team updated successfully');
      setEditingTeam(null);
      await fetchTeams();
    } catch (error: any) {
      console.error('Error updating team:', error);
      toast.error('Failed to update team');
    }
  };

  const handleCancel = () => {
    setEditingTeam(null);
    setEditData({});
  };

  const handleEditMember = (member: TeamMember) => {
    setEditingMember(member.id);
    setEditMemberData({
      fullName: member.fullName,
      email: member.email,
      phone: member.phone,
      gender: member.gender,
      role: member.role,
    });
  };

  const handleSaveMember = async (memberId: string) => {
    try {
      await databases.updateDocument(
        DATABASE_ID,
        COLLECTIONS.MEMBERS,
        memberId,
        {
          full_name: editMemberData.fullName,
          email: editMemberData.email,
          phone: editMemberData.phone,
          gender: editMemberData.gender,
          role: editMemberData.role,
        }
      );

      toast.success('Member updated successfully');
      setEditingMember(null);
      await fetchTeams();
    } catch (error: any) {
      console.error('Error updating member:', error);
      toast.error('Failed to update member');
    }
  };

  const handleCancelMember = () => {
    setEditingMember(null);
    setEditMemberData({});
  };

  const handleDeleteMember = async (memberId: string, memberName: string) => {
    if (!confirm(`Are you sure you want to delete ${memberName} from the team?`)) {
      return;
    }

    try {
      await databases.deleteDocument(
        DATABASE_ID,
        COLLECTIONS.MEMBERS,
        memberId
      );

      toast.success('Member deleted successfully');
      await fetchTeams();
    } catch (error: any) {
      console.error('Error deleting member:', error);
      toast.error('Failed to delete member');
    }
  };

  const handleDeleteTeam = async (teamId: string, teamName: string) => {
    if (!confirm(`Are you sure you want to delete the entire team "${teamName}"? This will also delete all team members. This action cannot be undone.`)) {
      return;
    }

    try {
      // First delete all members
      const team = teams.find(t => t.id === teamId);
      if (team && team.members.length > 0) {
        await Promise.all(
          team.members.map(member =>
            databases.deleteDocument(DATABASE_ID, COLLECTIONS.MEMBERS, member.id)
          )
        );
      }

      // Then delete the team
      await databases.deleteDocument(
        DATABASE_ID,
        COLLECTIONS.TEAMS,
        teamId
      );

      toast.success('Team deleted successfully');
      await fetchTeams();
    } catch (error: any) {
      console.error('Error deleting team:', error);
      toast.error('Failed to delete team');
    }
  };

  // Filter teams
  const filteredTeams = teams.filter((team) => {
    const query = searchQuery.toLowerCase();
    const matchesSearch = 
      team.teamName.toLowerCase().includes(query) ||
      team.institutionName.toLowerCase().includes(query) ||
      team.teamLeadName.toLowerCase().includes(query) ||
      team.teamLeadEmail.toLowerCase().includes(query) ||
      team.teamCode.toLowerCase().includes(query) ||
      team.ideaTitle.toLowerCase().includes(query);
    
    const matchesStatus = statusFilter === 'all' || team.status === statusFilter;
    const matchesDistrict = districtFilter === 'all' || team.district === districtFilter;
    
    return matchesSearch && matchesStatus && matchesDistrict;
  });

  const uniqueStatuses = Array.from(new Set(teams.map(t => t.status))).sort();
  const uniqueDistricts = Array.from(new Set(teams.map(t => t.district))).sort();

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
          <h1 className="text-3xl font-bold tracking-tight">All Teams</h1>
          <p className="text-gray-600">View, search, and manage all registered teams</p>
        </div>
      </FadeIn>

      {/* Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <SlideIn delay={0.05}>
          <Card className="border-gray-100">
            <CardContent className="pt-6">
              <div className="text-center">
                <p className="text-sm text-gray-600">Total Teams</p>
                <p className="text-3xl font-bold">{teams.length}</p>
              </div>
            </CardContent>
          </Card>
        </SlideIn>
        <SlideIn delay={0.1}>
          <Card className="border-gray-100">
            <CardContent className="pt-6">
              <div className="text-center">
                <p className="text-sm text-gray-600">Registered</p>
                <p className="text-3xl font-bold text-green-600">
                  {teams.filter(t => t.status === 'registered').length}
                </p>
              </div>
            </CardContent>
          </Card>
        </SlideIn>
        <SlideIn delay={0.15}>
          <Card className="border-gray-100">
            <CardContent className="pt-6">
              <div className="text-center">
                <p className="text-sm text-gray-600">Waitlisted</p>
                <p className="text-3xl font-bold text-yellow-600">
                  {teams.filter(t => t.status === 'waitlisted').length}
                </p>
              </div>
            </CardContent>
          </Card>
        </SlideIn>
        <SlideIn delay={0.2}>
          <Card className="border-gray-100">
            <CardContent className="pt-6">
              <div className="text-center">
                <p className="text-sm text-gray-600">Submitted</p>
                <p className="text-3xl font-bold text-blue-600">
                  {teams.filter(t => t.status === 'submitted').length}
                </p>
              </div>
            </CardContent>
          </Card>
        </SlideIn>
      </div>

      {/* Search and Filters */}
      <SlideIn delay={0.25}>
        <Card className="border-gray-100 mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Search className="h-5 w-5" />
              Search & Filter
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Search teams..."
                  className="pl-10"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              <Select value={districtFilter} onValueChange={setDistrictFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Filter by District" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Districts</SelectItem>
                  {uniqueDistricts.map((district) => (
                    <SelectItem key={district} value={district}>
                      {district}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Filter by Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  {uniqueStatuses.map((status) => (
                    <SelectItem key={status} value={status}>
                      {status.charAt(0).toUpperCase() + status.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {(searchQuery || statusFilter !== 'all' || districtFilter !== 'all') && (
              <p className="text-sm text-gray-500 mt-3">
                Showing {filteredTeams.length} of {teams.length} teams
              </p>
            )}
          </CardContent>
        </Card>
      </SlideIn>

      {/* Teams List */}
      {isFetching ? (
        <SlideIn delay={0.3}>
          <Card className="border-gray-100">
            <CardContent className="py-12">
              <div className="text-center">
                <p className="text-gray-600">Loading teams...</p>
              </div>
            </CardContent>
          </Card>
        </SlideIn>
      ) : filteredTeams.length === 0 ? (
        <SlideIn delay={0.3}>
          <Card className="border-gray-100">
            <CardContent className="py-12">
              <p className="text-gray-600 text-center">No teams found</p>
            </CardContent>
          </Card>
        </SlideIn>
      ) : (
        <div className="space-y-4">
          {filteredTeams.map((team, index) => (
            <SlideIn key={team.id} delay={0.01 * (index + 1)}>
              <Card className="border-gray-100 hover:shadow-md transition-shadow">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      {editingTeam === team.id ? (
                        <Input
                          value={editData.teamName || ''}
                          onChange={(e) => setEditData({ ...editData, teamName: e.target.value })}
                          className="text-xl font-bold mb-2"
                        />
                      ) : (
                        <CardTitle className="text-xl">{team.teamName}</CardTitle>
                      )}
                      <div className="flex flex-wrap gap-3 mt-3">
                        <div className="flex items-center gap-1.5 text-sm text-gray-600">
                          <Building2 className="h-4 w-4" />
                          <span>{team.institutionName}</span>
                        </div>
                        {editingTeam === team.id ? (
                          <div className="flex items-center gap-1.5">
                            <MapPin className="h-4 w-4 text-gray-600" />
                            <Input
                              value={editData.district || ''}
                              onChange={(e) => setEditData({ ...editData, district: e.target.value })}
                              placeholder="District"
                              className="h-7 w-32 text-sm"
                            />
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 text-sm text-gray-600">
                            <MapPin className="h-4 w-4" />
                            <span>{team.district}</span>
                          </div>
                        )}
                        {editingTeam === team.id ? (
                          <Input
                            value={editData.teamCode || ''}
                            onChange={(e) => setEditData({ ...editData, teamCode: e.target.value })}
                            placeholder="Team Code"
                            className="h-7 w-32 text-xs font-mono"
                          />
                        ) : (
                          team.teamCode && (
                            <span className="text-xs font-mono bg-blue-50 text-blue-600 px-2 py-1 rounded">
                              {team.teamCode}
                            </span>
                          )
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {editingTeam === team.id ? (
                        <Select 
                          value={editData.status || team.status} 
                          onValueChange={(value) => setEditData({ ...editData, status: value })}
                        >
                          <SelectTrigger className="w-32">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="waitlisted">Waitlisted</SelectItem>
                            <SelectItem value="registered">Registered</SelectItem>
                            <SelectItem value="submitted">Submitted</SelectItem>
                            <SelectItem value="selected">Selected</SelectItem>
                            <SelectItem value="rejected">Rejected</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className={`text-xs px-3 py-1 rounded-full font-medium ${
                          team.status === 'registered' 
                            ? 'bg-green-100 text-green-800'
                            : team.status === 'submitted'
                            ? 'bg-blue-100 text-blue-800'
                            : team.status === 'waitlisted'
                            ? 'bg-yellow-100 text-yellow-800'
                            : team.status === 'selected'
                            ? 'bg-purple-100 text-purple-800'
                            : 'bg-red-100 text-red-800'
                        }`}>
                          {team.status}
                        </span>
                      )}
                      {editingTeam === team.id ? (
                        <>
                          <Button size="sm" onClick={() => handleSave(team.id)}>
                            <Save className="h-4 w-4 mr-1" />
                            Save
                          </Button>
                          <Button size="sm" variant="outline" onClick={handleCancel}>
                            <X className="h-4 w-4 mr-1" />
                            Cancel
                          </Button>
                          <Button 
                            size="sm" 
                            variant="outline" 
                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            onClick={() => handleDeleteTeam(team.id, team.teamName)}
                          >
                            <Trash2 className="h-4 w-4 mr-1" />
                            Delete Team
                          </Button>
                        </>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => handleEdit(team)}>
                          <Edit2 className="h-4 w-4 mr-1" />
                          Edit
                        </Button>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid md:grid-cols-2 gap-6">
                    {/* Team Lead Info */}
                    <div className="space-y-3">
                      <h3 className="font-semibold text-sm text-gray-700">Team Lead</h3>
                      {editingTeam === team.id ? (
                        <div className="space-y-2">
                          <Input
                            placeholder="Team Lead Name"
                            value={editData.teamLeadName || ''}
                            onChange={(e) => setEditData({ ...editData, teamLeadName: e.target.value })}
                          />
                          <Input
                            placeholder="Team Lead Email"
                            type="email"
                            value={editData.teamLeadEmail || ''}
                            onChange={(e) => setEditData({ ...editData, teamLeadEmail: e.target.value })}
                          />
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <p className="text-sm font-medium">{team.teamLeadName}</p>
                          <div className="flex items-center gap-2 text-sm text-gray-600">
                            <Mail className="h-3.5 w-3.5" />
                            <span className="truncate">{team.teamLeadEmail}</span>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Team Members */}
                    <div className="space-y-3">
                      <h3 className="font-semibold text-sm text-gray-700">Team Members ({team.members.length})</h3>
                      {team.members.length > 0 ? (
                        <div className="space-y-3">
                          {team.members.map((member) => (
                            <div key={member.id} className="border rounded-lg p-3 space-y-2">
                              {editingMember === member.id ? (
                                <div className="space-y-2">
                                  <Input
                                    placeholder="Full Name"
                                    value={editMemberData.fullName || ''}
                                    onChange={(e) => setEditMemberData({ ...editMemberData, fullName: e.target.value })}
                                    className="text-sm"
                                  />
                                  <Input
                                    placeholder="Email"
                                    type="email"
                                    value={editMemberData.email || ''}
                                    onChange={(e) => setEditMemberData({ ...editMemberData, email: e.target.value })}
                                    className="text-sm"
                                  />
                                  <Input
                                    placeholder="Phone"
                                    value={editMemberData.phone || ''}
                                    onChange={(e) => setEditMemberData({ ...editMemberData, phone: e.target.value })}
                                    className="text-sm"
                                  />
                                  <div className="grid grid-cols-2 gap-2">
                                    <Select 
                                      value={editMemberData.gender || member.gender}
                                      onValueChange={(value) => setEditMemberData({ ...editMemberData, gender: value })}
                                    >
                                      <SelectTrigger className="text-sm">
                                        <SelectValue placeholder="Gender" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="Male">Male</SelectItem>
                                        <SelectItem value="Female">Female</SelectItem>
                                        <SelectItem value="Other">Other</SelectItem>
                                      </SelectContent>
                                    </Select>
                                    <Input
                                      placeholder="Role"
                                      value={editMemberData.role || ''}
                                      onChange={(e) => setEditMemberData({ ...editMemberData, role: e.target.value })}
                                      className="text-sm"
                                    />
                                  </div>
                                  <div className="flex gap-2">
                                    <Button size="sm" onClick={() => handleSaveMember(member.id)} className="flex-1">
                                      <Save className="h-3 w-3 mr-1" />
                                      Save
                                    </Button>
                                    <Button size="sm" variant="outline" onClick={handleCancelMember} className="flex-1">
                                      <X className="h-3 w-3 mr-1" />
                                      Cancel
                                    </Button>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  <div className="flex items-start justify-between">
                                    <div className="flex-1">
                                      <p className="font-medium text-sm">{member.fullName}</p>
                                      <p className="text-xs text-gray-500">{member.role} • {member.gender}</p>
                                    </div>
                                    {editingTeam === team.id && (
                                      <div className="flex gap-1">
                                        <Button 
                                          size="sm" 
                                          variant="ghost" 
                                          className="h-7 w-7 p-0"
                                          onClick={() => handleEditMember(member)}
                                        >
                                          <Edit2 className="h-3 w-3" />
                                        </Button>
                                        <Button 
                                          size="sm" 
                                          variant="ghost" 
                                          className="h-7 w-7 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                                          onClick={() => handleDeleteMember(member.id, member.fullName)}
                                        >
                                          <Trash2 className="h-3 w-3" />
                                        </Button>
                                      </div>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2 text-xs text-gray-600">
                                    <Mail className="h-3 w-3" />
                                    <span className="truncate">{member.email}</span>
                                  </div>
                                  {member.phone && (
                                    <div className="flex items-center gap-2 text-xs text-gray-600">
                                      <Phone className="h-3 w-3" />
                                      <span>{member.phone}</span>
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-gray-500">No members added</p>
                      )}
                    </div>
                  </div>

                  {/* Idea Details - Read Only */}
                  {team.ideaTitle && (
                    <div className="mt-6 pt-6 border-t space-y-3">
                      <h3 className="font-semibold text-sm text-gray-700">Project Idea</h3>
                      <p className="font-medium">{team.ideaTitle}</p>
                      {team.ideaDesc && (
                        <p className="text-sm text-gray-600 line-clamp-2">{team.ideaDesc}</p>
                      )}
                      {team.techStack && (
                        <p className="text-xs text-gray-500">
                          <span className="font-medium">Tech Stack:</span> {team.techStack}
                        </p>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </SlideIn>
          ))}
        </div>
      )}
    </div>
  );
}
