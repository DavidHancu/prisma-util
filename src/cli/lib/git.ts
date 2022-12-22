import os, { SignalConstants } from "os";
import axios, { AxiosError, AxiosResponse } from "axios";

type BranchResult = {
    name: string,
    commit: {
      sha: string,
      url: string
    },
    protected: boolean
};

type GitHubAPIResponse<T> = {
    success: false,
    status: number
} | {
    success: true,
    data: T
};

export const ROOT = "DavidHancu/prisma-util";

const GitCreator = (root: string) => {
    return {
        Branch: {
            list: async () => {
                const res = await queryAxios<BranchResult[]>(`https://api.github.com/repos/${root}/branches`); 

                if(!res.success)
                    return [] as string[];

                return res.data.map(branch => branch.name);
            },
            exists: async (branchName: string) => {
                const res = await queryAxios<BranchResult>(`https://api.github.com/repos/${root}/branches/${branchName}`);

                return res.success;
            }
        },
        File: {
            get: async <T = string>(branch: string, file: string) => {
                const res = await queryAxios<T>(`https://raw.githubusercontent.com/${root}/${branch}/${file}`);
                
                if(!res.success)
                    return undefined;

                return res.data;
            }
        }
    };
};

function queryAxios<T>(link: string): Promise<GitHubAPIResponse<T>>
{
    return new Promise(async (resolve) => {
        await axios
            .get(link)
            .catch((axiosError: AxiosError) => {
                resolve({
                    success: false,
                    status: axiosError.response?.status ? axiosError.response?.status : 404
                });
            })
            .then((axiosResponse: void | AxiosResponse) => {
                resolve({
                    success: true,
                    data: (typeof axiosResponse == "object") ? axiosResponse.data as T : axiosResponse as T
                });
            });
    })
}

export default GitCreator;