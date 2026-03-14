import { DynamicModule, Module } from '@nestjs/common';
import { Aes256Service } from './aes-256.service';

export interface Aes256ModuleOptions {
  key: string;
  salt: string;
}

@Module({})
export class Aes256Module {
  static register(options: Aes256ModuleOptions): DynamicModule {
    return {
      module: Aes256Module,
      providers: [
        {
          provide: 'AES256_CONFIG',
          useValue: options,
        },
        Aes256Service,
      ],
      exports: [Aes256Service], // Make sure this is exported
    };
  }

  static registerAsync(options: {
    imports?: any[];
    useFactory: (...args: any[]) => Promise<Aes256ModuleOptions> | Aes256ModuleOptions;
    inject?: any[];
  }): DynamicModule {
    return {
      module: Aes256Module,
      imports: options.imports,
      providers: [
        {
          provide: 'AES256_CONFIG',
          useFactory: options.useFactory,
          inject: options.inject,
        },
        Aes256Service,
      ],
      exports: [Aes256Service], // Make sure this is exported
    };
  }
}
