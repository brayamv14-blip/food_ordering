import * as sdk from 'node-appwrite';

const mock = globalThis.__APPWRITE_TEST_ADAPTER__ ?? {};

export const Client = mock.Client ?? sdk.Client;
export const ID = mock.ID ?? sdk.ID;
export const Messaging = mock.Messaging ?? sdk.Messaging;
export const Permission = mock.Permission ?? sdk.Permission;
export const Query = mock.Query ?? sdk.Query;
export const Role = mock.Role ?? sdk.Role;
export const TablesDB = mock.TablesDB ?? sdk.TablesDB;
export const Users = mock.Users ?? sdk.Users;
