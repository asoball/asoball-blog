// mongosh script. Initialize only a fresh local volume; never reconfigure an existing set.
try {
  rs.status();
} catch (error) {
  if (error.code !== 94) throw error; // NotYetInitialized
  const result = rs.initiate({
    _id: "rs0",
    members: [{ _id: 0, host: "localhost:27017" }],
  });
  if (result.ok !== 1) quit(1);
}

// A ping is insufficient: transactions need an elected primary.
quit(db.hello().isWritablePrimary ? 0 : 1);
