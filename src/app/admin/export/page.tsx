// src/app/admin/export/page.tsx - Export Teams and Members Data
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FadeIn } from '@/components/animations/FadeIn';
import { SlideIn } from '@/components/animations/SlideIn';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { authHelpers, UserRole, databases, DATABASE_ID, COLLECTIONS } from '@/lib/appwrite';
import { Search, Download, ArrowLeft, FileDown } from 'lucide-react';
import { toast } from 'sonner';
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

export default function AdminExportPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [isFetching, setIsFetching] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [districtFilter, setDistrictFilter] = useState<string>('all');
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedColumns, setSelectedColumns] = useState({
    teamName: true,
    institutionName: true,
    district: true,
    status: true,
    teamCode: true,
    teamLeadName: true,
    teamLeadEmail: true,
    ideaTitle: true,
    ideaDesc: true,
    techStack: true,
    memberCount: true,
    memberDetails: true,
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

  const downloadCSV = () => {
    const headers: string[] = [];
    const cols = selectedColumns;

    if (cols.teamName) headers.push('Team Name');
    if (cols.institutionName) headers.push('Institution');
    if (cols.district) headers.push('District');
    if (cols.status) headers.push('Status');
    if (cols.teamCode) headers.push('Team Code');
    if (cols.teamLeadName) headers.push('Team Lead Name');
    if (cols.teamLeadEmail) headers.push('Team Lead Email');
    if (cols.ideaTitle) headers.push('Idea Title');
    if (cols.ideaDesc) headers.push('Idea Description');
    if (cols.techStack) headers.push('Tech Stack');
    if (cols.memberCount) headers.push('Member Count');
    
    if (cols.memberDetails) {
      headers.push('Member 1 Name', 'Member 1 Email', 'Member 1 Phone', 'Member 1 Gender', 'Member 1 Role');
      headers.push('Member 2 Name', 'Member 2 Email', 'Member 2 Phone', 'Member 2 Gender', 'Member 2 Role');
      headers.push('Member 3 Name', 'Member 3 Email', 'Member 3 Phone', 'Member 3 Gender', 'Member 3 Role');
      headers.push('Member 4 Name', 'Member 4 Email', 'Member 4 Phone', 'Member 4 Gender', 'Member 4 Role');
    }

    const rows = filteredTeams.map(team => {
      const row: string[] = [];
      
      if (cols.teamName) row.push(escapeCSV(team.teamName));
      if (cols.institutionName) row.push(escapeCSV(team.institutionName));
      if (cols.district) row.push(escapeCSV(team.district));
      if (cols.status) row.push(escapeCSV(team.status));
      if (cols.teamCode) row.push(escapeCSV(team.teamCode));
      if (cols.teamLeadName) row.push(escapeCSV(team.teamLeadName));
      if (cols.teamLeadEmail) row.push(escapeCSV(team.teamLeadEmail));
      if (cols.ideaTitle) row.push(escapeCSV(team.ideaTitle));
      if (cols.ideaDesc) row.push(escapeCSV(team.ideaDesc));
      if (cols.techStack) row.push(escapeCSV(team.techStack));
      if (cols.memberCount) row.push(team.members.length.toString());
      
      if (cols.memberDetails) {
        for (let i = 0; i < 4; i++) {
          const member = team.members[i];
          if (member) {
            row.push(
              escapeCSV(member.fullName),
              escapeCSV(member.email),
              escapeCSV(member.phone),
              escapeCSV(member.gender),
              escapeCSV(member.role)
            );
          } else {
            row.push('', '', '', '', '');
          }
        }
      }
      
      return row.join(',');
    });

    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', `teams_export_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    toast.success(`CSV downloaded successfully with ${filteredTeams.length} teams`);
  };

  const escapeCSV = (str: string) => {
    if (!str) return '';
    const text = str.toString().replace(/"/g, '""');
    return text.includes(',') || text.includes('\n') || text.includes('"') ? `"${text}"` : text;
  };

  const toggleColumn = (column: keyof typeof selectedColumns) => {
    setSelectedColumns(prev => ({ ...prev, [column]: !prev[column] }));
  };

  const selectAllColumns = () => {
    setSelectedColumns({
      teamName: true,
      institutionName: true,
      district: true,
      status: true,
      teamCode: true,
      teamLeadName: true,
      teamLeadEmail: true,
      ideaTitle: true,
      ideaDesc: true,
      techStack: true,
      memberCount: true,
      memberDetails: true,
    });
  };

  const deselectAllColumns = () => {
    setSelectedColumns({
      teamName: false,
      institutionName: false,
      district: false,
      status: false,
      teamCode: false,
      teamLeadName: false,
      teamLeadEmail: false,
      ideaTitle: false,
      ideaDesc: false,
      techStack: false,
      memberCount: false,
      memberDetails: false,
    });
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
          <h1 className="text-3xl font-bold tracking-tight">Export Data</h1>
          <p className="text-gray-600">Download team and member data as CSV with custom columns and filters</p>
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
                <p className="text-sm text-gray-600">Filtered Teams</p>
                <p className="text-3xl font-bold text-blue-600">{filteredTeams.length}</p>
              </div>
            </CardContent>
          </Card>
        </SlideIn>
        <SlideIn delay={0.15}>
          <Card className="border-gray-100">
            <CardContent className="pt-6">
              <div className="text-center">
                <p className="text-sm text-gray-600">Total Members</p>
                <p className="text-3xl font-bold">{teams.reduce((sum, t) => sum + t.members.length, 0)}</p>
              </div>
            </CardContent>
          </Card>
        </SlideIn>
        <SlideIn delay={0.2}>
          <Card className="border-gray-100">
            <CardContent className="pt-6">
              <div className="text-center">
                <p className="text-sm text-gray-600">Filtered Members</p>
                <p className="text-3xl font-bold text-blue-600">
                  {filteredTeams.reduce((sum, t) => sum + t.members.length, 0)}
                </p>
              </div>
            </CardContent>
          </Card>
        </SlideIn>
      </div>

      {/* Filters */}
      <SlideIn delay={0.25}>
        <Card className="border-gray-100 mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Search className="h-5 w-5" />
              Filter Data
            </CardTitle>
            <CardDescription>
              Apply filters to narrow down the teams you want to export
            </CardDescription>
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

      {/* Column Selection */}
      <SlideIn delay={0.3}>
        <Card className="border-gray-100 mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileDown className="h-5 w-5" />
              Select Columns to Export
            </CardTitle>
            <CardDescription>
              Choose which data fields to include in your CSV export
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={selectAllColumns}>
                  Select All
                </Button>
                <Button size="sm" variant="outline" onClick={deselectAllColumns}>
                  Deselect All
                </Button>
              </div>
              
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                <label className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-2 rounded">
                  <input
                    type="checkbox"
                    checked={selectedColumns.teamName}
                    onChange={() => toggleColumn('teamName')}
                    className="w-4 h-4 cursor-pointer"
                  />
                  <span className="text-sm">Team Name</span>
                </label>
                
                <label className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-2 rounded">
                  <input
                    type="checkbox"
                    checked={selectedColumns.institutionName}
                    onChange={() => toggleColumn('institutionName')}
                    className="w-4 h-4 cursor-pointer"
                  />
                  <span className="text-sm">Institution</span>
                </label>
                
                <label className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-2 rounded">
                  <input
                    type="checkbox"
                    checked={selectedColumns.district}
                    onChange={() => toggleColumn('district')}
                    className="w-4 h-4 cursor-pointer"
                  />
                  <span className="text-sm">District</span>
                </label>
                
                <label className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-2 rounded">
                  <input
                    type="checkbox"
                    checked={selectedColumns.status}
                    onChange={() => toggleColumn('status')}
                    className="w-4 h-4 cursor-pointer"
                  />
                  <span className="text-sm">Status</span>
                </label>
                
                <label className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-2 rounded">
                  <input
                    type="checkbox"
                    checked={selectedColumns.teamCode}
                    onChange={() => toggleColumn('teamCode')}
                    className="w-4 h-4 cursor-pointer"
                  />
                  <span className="text-sm">Team Code</span>
                </label>
                
                <label className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-2 rounded">
                  <input
                    type="checkbox"
                    checked={selectedColumns.teamLeadName}
                    onChange={() => toggleColumn('teamLeadName')}
                    className="w-4 h-4 cursor-pointer"
                  />
                  <span className="text-sm">Team Lead Name</span>
                </label>
                
                <label className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-2 rounded">
                  <input
                    type="checkbox"
                    checked={selectedColumns.teamLeadEmail}
                    onChange={() => toggleColumn('teamLeadEmail')}
                    className="w-4 h-4 cursor-pointer"
                  />
                  <span className="text-sm">Team Lead Email</span>
                </label>
                
                <label className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-2 rounded">
                  <input
                    type="checkbox"
                    checked={selectedColumns.ideaTitle}
                    onChange={() => toggleColumn('ideaTitle')}
                    className="w-4 h-4 cursor-pointer"
                  />
                  <span className="text-sm">Idea Title</span>
                </label>
                
                <label className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-2 rounded">
                  <input
                    type="checkbox"
                    checked={selectedColumns.ideaDesc}
                    onChange={() => toggleColumn('ideaDesc')}
                    className="w-4 h-4 cursor-pointer"
                  />
                  <span className="text-sm">Idea Description</span>
                </label>
                
                <label className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-2 rounded">
                  <input
                    type="checkbox"
                    checked={selectedColumns.techStack}
                    onChange={() => toggleColumn('techStack')}
                    className="w-4 h-4 cursor-pointer"
                  />
                  <span className="text-sm">Tech Stack</span>
                </label>
                
                <label className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-2 rounded">
                  <input
                    type="checkbox"
                    checked={selectedColumns.memberCount}
                    onChange={() => toggleColumn('memberCount')}
                    className="w-4 h-4 cursor-pointer"
                  />
                  <span className="text-sm">Member Count</span>
                </label>
                
                <label className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-2 rounded border-2 border-blue-200 bg-blue-50">
                  <input
                    type="checkbox"
                    checked={selectedColumns.memberDetails}
                    onChange={() => toggleColumn('memberDetails')}
                    className="w-4 h-4 cursor-pointer"
                  />
                  <span className="text-sm font-medium text-blue-700">All Member Details</span>
                </label>
              </div>
              
              {selectedColumns.memberDetails && (
                <div className="bg-blue-50 border border-blue-200 rounded p-3 text-sm text-blue-700">
                  <p className="font-medium mb-1">Member Details includes:</p>
                  <p>Name, Email, Phone, Gender, and Role for up to 4 team members per team</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </SlideIn>

      {/* Download Button */}
      <SlideIn delay={0.35}>
        <Card className="border-gray-100">
          <CardContent className="pt-6">
            {isFetching ? (
              <div className="text-center py-8">
                <p className="text-gray-600">Loading teams data...</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-4">
                <Button 
                  onClick={downloadCSV}
                  size="lg"
                  disabled={filteredTeams.length === 0}
                  className="w-full md:w-auto"
                >
                  <Download className="h-5 w-5 mr-2" />
                  Download CSV ({filteredTeams.length} teams, {filteredTeams.reduce((sum, t) => sum + t.members.length, 0)} members)
                </Button>
                
                {filteredTeams.length === 0 && (
                  <p className="text-sm text-gray-500">
                    No teams match your current filters. Adjust filters to export data.
                  </p>
                )}
                
                {filteredTeams.length > 0 && (
                  <p className="text-sm text-gray-500 text-center">
                    Filename: teams_export_{new Date().toISOString().split('T')[0]}.csv
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </SlideIn>
    </div>
  );
}
