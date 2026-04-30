declare module 'sql.js' {
    interface SqlJsStatic {
        Database: new (data?: ArrayLike<number> | Buffer | null) => Database;
    }

    interface QueryExecResult {
        columns: string[];
        values: any[][];
    }

    interface Database {
        run(sql: string, params?: any[]): Database;
        exec(sql: string, params?: any[]): QueryExecResult[];
        export(): Uint8Array;
        close(): void;
    }

    interface SqlJsConfig {
        locateFile?: (file: string) => string;
    }

    export default function initSqlJs(config?: SqlJsConfig): Promise<SqlJsStatic>;
    export { Database, SqlJsStatic, QueryExecResult };
}
