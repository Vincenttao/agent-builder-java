import type {ProjectPackage} from '../../../../packages/contracts/src/project-package.js';
import {AppError} from '../shared/errors.js';
import type {Pool} from '../db/pool.js';

export interface ProjectPackageStore {
  save(draftId:string,source:ProjectPackage):Promise<void>;
  get(draftId:string):Promise<ProjectPackage|undefined>;
}

export class PostgresProjectPackageStore implements ProjectPackageStore {
  constructor(private readonly pool:Pool){}
  async save(draftId:string,source:ProjectPackage):Promise<void>{
    await this.pool.query('INSERT INTO imported_project_packages(draft_id,source_project_id,package_digest,package) VALUES($1,$2,$3,$4) ON CONFLICT(draft_id) DO NOTHING',
      [draftId,source.source.projectId,source.packageDigest,source]);
    const row=(await this.pool.query<{package_digest:string}>('SELECT package_digest FROM imported_project_packages WHERE draft_id=$1',[draftId])).rows[0];
    if(row?.package_digest!==source.packageDigest)throw new AppError('PROJECT_RECOVERY_PACKAGE_CONFLICT','导入项目已有不同的恢复包',409);
  }
  async get(draftId:string):Promise<ProjectPackage|undefined>{
    return(await this.pool.query<{package:ProjectPackage}>('SELECT package FROM imported_project_packages WHERE draft_id=$1',[draftId])).rows[0]?.package;
  }
}
