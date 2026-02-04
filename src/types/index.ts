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
