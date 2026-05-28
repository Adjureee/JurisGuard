import { create } from "zustand";

interface ProfileImageState {
  imagesByUserId: Record<number, string>;
  setProfileImage: (userId: number, imagePath: string) => void;
  removeProfileImage: (userId: number) => void;
}

export const useProfileImageStore = create<ProfileImageState>((set, get) => ({
  imagesByUserId: {},
  setProfileImage: (userId, imagePath) => {
    const imagesByUserId = { ...get().imagesByUserId, [userId]: imagePath };
    set({ imagesByUserId });
  },
  removeProfileImage: (userId) => {
    const imagesByUserId = { ...get().imagesByUserId };
    delete imagesByUserId[userId];
    set({ imagesByUserId });
  },
}));
