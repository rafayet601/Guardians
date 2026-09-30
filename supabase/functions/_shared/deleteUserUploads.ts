interface StorageClient {
  storage: {
    from(bucket: string): {
      list(
        path: string,
        options: { limit: number; offset: number; sortBy: { column: string; order: string } },
      ): Promise<{
        data: { name: string; id: string | null }[] | null;
        error: { message: string } | null;
      }>;
      remove(paths: string[]): Promise<{ error: { message: string } | null }>;
    };
  };
}

/** Remove files through Storage API before deleting their owner in Auth. */
export async function deleteUserUploads(admin: StorageClient, userId: string): Promise<void> {
  for (const bucket of ['avatars', 'cat-photos', 'screening-docs']) {
    const storage = admin.storage.from(bucket);
    const paths: string[] = [];
    const folders = [userId];
    while (folders.length) {
      const folder = folders.pop()!;
      for (let offset = 0; ; offset += 100) {
        const { data, error } = await storage.list(folder, {
          limit: 100,
          offset,
          sortBy: { column: 'name', order: 'asc' },
        });
        if (error || !data) throw new Error('Unable to list account uploads');
        for (const object of data) {
          const path = `${folder}/${object.name}`;
          if (object.id) paths.push(path);
          else folders.push(path);
        }
        if (data.length < 100) break;
      }
    }
    // Do not mutate a listing while paginating: offsets would skip objects.
    for (let i = 0; i < paths.length; i += 100) {
      const { error } = await storage.remove(paths.slice(i, i + 100));
      if (error) throw new Error('Unable to remove account uploads');
    }
  }
}
