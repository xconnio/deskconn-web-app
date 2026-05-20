export interface User {
    id: string | number
    name?: string
    email?: string
}

export interface OrganizationMember {
    role: string
    user: User
    user_id: string | number
}

export interface OrganizationInvite {
    id: string
    organization_id: string
    role: 'admin' | 'member'
    status: 'pending' | 'accepted' | 'rejected' | 'expired'
    expires_at: string
    created_at: string
    invitee_id?: string
    organization?: { id: string; name: string }
    invitee?: User
}

export interface Organization {
    id: string
    name: string
    members?: OrganizationMember[]
    owner?: User
    role?: string // For dashboard display
    icon?: string // For dashboard display
}

export interface Device {
    id: string
    name: string
    type: string
    status: 'Online' | 'Offline'
    icon: string
}

export interface Desktop {
  id: string
  name: string
  realm: string
  icon: string
  user_id?: string
  role?: string
}

export interface DesktopUserAccess {
  id: string
  desktop_id: string
  user_id: string
  role: 'owner' | 'admin' | 'member'
  created_at: string
  user?: User
}

export interface DesktopOrganizationAccess {
  id: string
  desktop_id: string
  organization_id: string
  role: 'admin' | 'member'
  created_at: string
  organization?: Organization
}

export interface DesktopInvite {
  id: string
  desktop_id: string
  role: 'admin' | 'member'
  status: 'pending' | 'accepted' | 'rejected' | 'expired'
  expires_at: string
  created_at: string
  invitee_user_id?: string
  invitee_organization_id?: string
  desktop?: { id: string; name: string }
  invitee_user?: User
}

export interface FileEntry {
  name: string
  path: string
  type: string
  mode: string
  size: number
  hidden: boolean
  mod_time: string
  is_dir: boolean
  is_symlink: boolean
  link_target?: string
  item_count?: number
}

export interface FileBrowseResult {
  path: string
  home_path: string
  parent_path?: string
  type: string
  mode: string
  size: number
  mod_time: string
  is_dir: boolean
  is_symlink: boolean
  link_target?: string
  entries?: FileEntry[]
}
