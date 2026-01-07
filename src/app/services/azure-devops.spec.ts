import { TestBed } from '@angular/core/testing';

import { AzureDevops } from './azure-devops';

describe('AzureDevops', () => {
  let service: AzureDevops;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(AzureDevops);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
