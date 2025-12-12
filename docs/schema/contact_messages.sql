-- Create contact_messages table for storing user contact form submissions
-- This table stores messages sent through the contact form on the website

CREATE TABLE IF NOT EXISTS public.contact_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'resolved', 'archived')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index on user_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_contact_messages_user_id 
  ON public.contact_messages(user_id);

-- Create index on status for filtering
CREATE INDEX IF NOT EXISTS idx_contact_messages_status 
  ON public.contact_messages(status);

-- Create index on created_at for sorting
CREATE INDEX IF NOT EXISTS idx_contact_messages_created_at 
  ON public.contact_messages(created_at DESC);

-- Enable Row Level Security (RLS)
ALTER TABLE public.contact_messages ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own messages
CREATE POLICY "Users can view their own contact messages"
  ON public.contact_messages
  FOR SELECT
  USING (auth.uid() = user_id);

-- Policy: Anyone can insert contact messages (for the contact form)
CREATE POLICY "Anyone can submit contact messages"
  ON public.contact_messages
  FOR INSERT
  WITH CHECK (true);

-- Policy: Service role can do everything (for admin access)
CREATE POLICY "Service role has full access to contact messages"
  ON public.contact_messages
  FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

-- Create a function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_contact_messages_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to update updated_at on row updates
CREATE TRIGGER update_contact_messages_updated_at
  BEFORE UPDATE ON public.contact_messages
  FOR EACH ROW
  EXECUTE FUNCTION update_contact_messages_updated_at();

-- Add comment to table
COMMENT ON TABLE public.contact_messages IS 'Stores contact form submissions from users';
COMMENT ON COLUMN public.contact_messages.status IS 'Status of the message: new, in_progress, resolved, or archived';

