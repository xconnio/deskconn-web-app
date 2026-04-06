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
