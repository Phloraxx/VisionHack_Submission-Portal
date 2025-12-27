'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FadeIn } from '@/components/animations/FadeIn';
import { SlideIn } from '@/components/animations/SlideIn';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { motion } from 'framer-motion';
import { LogIn, AlertCircle } from 'lucide-react';
import { authHelpers } from '@/lib/appwrite';
import { toast } from 'sonner';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      // Login with Appwrite
      await authHelpers.login(email, password);
      
      // Get user and determine role
      const user = await authHelpers.getCurrentUser();
      if (!user) {
        throw new Error('Failed to get user data');
      }

      const role = authHelpers.getUserRole(user);
      
      if (!role) {
        throw new Error('No role assigned to this user');
      }
      
      const dashboard = authHelpers.getRoleDashboard(role);
      toast.success('Login successful!');
      router.push(dashboard);
    } catch (err: any) {
      console.error('Login error:', err);
      setError(err.message || 'Invalid email or password');
      toast.error('Login failed. Please check your credentials.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-12 bg-linear-to-b from-white to-gray-50">
      <SlideIn direction="up" className="w-full max-w-md">
        <Card className="border-gray-100 shadow-lg">
          <CardHeader className="space-y-1">
            <FadeIn delay={0.2}>
              <div className="text-center mb-2">
                <h1 className="text-3xl font-bold">Vision Hack 2026</h1>
              </div>
            </FadeIn>
            <FadeIn delay={0.3}>
              <CardTitle className="text-2xl font-bold text-center">Sign In</CardTitle>
            </FadeIn>
            <FadeIn delay={0.4}>
              <CardDescription className="text-center">
                Enter your credentials to access the portal
              </CardDescription>
            </FadeIn>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <FadeIn>
                  <div className="p-3 rounded-lg bg-red-50 border border-red-100 flex items-start gap-2">
                    <AlertCircle className="h-5 w-5 text-red-600 mt-0.5 shrink-0" />
                    <p className="text-sm text-red-600">{error}</p>
                  </div>
                </FadeIn>
              )}

              <FadeIn delay={0.5}>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="your@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    disabled={isLoading}
                  />
                </div>
              </FadeIn>

              <FadeIn delay={0.6}>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    disabled={isLoading}
                  />
                </div>
              </FadeIn>

              <FadeIn delay={0.7}>
                <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                  <Button 
                    type="submit" 
                    className="w-full" 
                    size="lg"
                    disabled={isLoading}
                  >
                    <LogIn className="mr-2 h-4 w-4" />
                    {isLoading ? 'Signing in...' : 'Sign In'}
                  </Button>
                </motion.div>
              </FadeIn>

              <FadeIn delay={0.8}>
                <p className="text-sm text-center text-gray-600">
                  Contact your administrator for access credentials
                </p>
              </FadeIn>
            </form>
          </CardContent>
        </Card>
      </SlideIn>
    </div>
  );
}
